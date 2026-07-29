import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import { CLI_PATH, spawnCli } from './helpers/cli-process.ts'

/**
 * End-to-end integration tests that spawn the compiled `./dist/facet` binary
 * as a subprocess and verify adapter install / list / remove behavior.
 *
 * These tests exercise the full real code path:
 *   - argv parsing and exit codes
 *   - `parseSpecifier` + source resolution
 *   - `bundleAdapter` (fast path + slow-path fallback in `locateAndVerifyAdapter`)
 *   - `verifyAdapter` (dynamic import of the bundle)
 *   - `placeAdapter` / `listInstalledAdapters` / `removeAdapter`
 *   - temp-dir cleanup in the `handleInstall` finally block
 *
 * Isolation: each test sets `FACET_DIR` to a unique `mkdtemp` dir
 * so the user's real `~/.facet/adapters/` is never touched.
 */

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

const runCli = (args: string[], env?: Record<string, string>) => spawnCli(args, { env })

/**
 * Pack the opencode adapter once per test run and extract the tarball.
 * Returns the extracted `package/` directory path — this mirrors exactly
 * what `downloadNpmPackage` would produce if the adapter were installed
 * from npm, without any network I/O.
 */
let extractedOpencodeDir: string | undefined
async function packOpencode(): Promise<string> {
  if (extractedOpencodeDir) return extractedOpencodeDir

  const adapterDir = resolve(REPO_ROOT, 'packages/adapters/opencode')
  const workDir = await mkdtemp(join(tmpdir(), 'facet-pack-opencode-'))

  // Run `npm pack --pack-destination <workDir>` inside the adapter directory.
  // This triggers prepack (rewrites workspace:* deps + hoists publishConfig)
  // and produces a .tgz identical to what `npm publish` would upload.
  const packProc = Bun.spawn(['npm', 'pack', '--pack-destination', workDir], {
    cwd: adapterDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const packStdout = await new Response(packProc.stdout).text()
  const packStderr = await new Response(packProc.stderr).text()
  const packExit = await packProc.exited
  if (packExit !== 0) {
    throw new Error(`npm pack failed (${packExit}):\nstdout: ${packStdout}\nstderr: ${packStderr}`)
  }

  // Find the produced tarball
  const entries = await readdir(workDir)
  const tarball = entries.find((name) => name.endsWith('.tgz'))
  if (!tarball) {
    throw new Error(`npm pack produced no tarball in ${workDir}`)
  }

  // Extract the tarball via `tar -xzf`
  const tarProc = Bun.spawn(['tar', '-xzf', tarball], {
    cwd: workDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const tarExit = await tarProc.exited
  if (tarExit !== 0) {
    const stderr = await new Response(tarProc.stderr).text()
    throw new Error(`tar extract failed (${tarExit}): ${stderr}`)
  }

  extractedOpencodeDir = join(workDir, 'package')
  return extractedOpencodeDir
}

/** Absolute path to the SDK source, for fixtures that need to inline it. */
const ADAPTER_SDK_SOURCE = resolve(REPO_ROOT, 'packages/adapter/src/index.ts')

/**
 * Write a minimal hand-crafted adapter fixture into `dir`.
 *
 * - `unbuilt`: only `package.json` + `src/index.ts`. The source inlines the
 *   SDK by absolute path so the slow-path Bun.build can find it without
 *   `bun install` needing to resolve `@agent-facets/adapter` externally.
 *
 * - `broken-prebuilt`: `package.json` points at `dist/index.mjs`. That
 *   bundle imports a package that doesn't exist, simulating a self-contained
 *   bundle that was published broken. A working `src/index.ts` is also
 *   written so the slow-path fallback has somewhere to go.
 *
 * - `externalized-prebuilt`: `package.json` points at `dist/index.mjs`. That
 *   bundle imports a runtime dep that IS present in the source tree's
 *   `node_modules/`, so an in-place verification would succeed — but the
 *   dep would vanish after `placeAdapter()` copies the bundle to
 *   `~/.facet/adapters/<name>/adapter.js`. This is the regression scenario
 *   from PR #142 / Codex review. Our fix verifies the bundle in an isolated
 *   temp dir (no neighboring node_modules), so the import correctly fails
 *   and the slow-path fallback kicks in. A working `src/index.ts` is
 *   provided so the slow path can complete.
 */
async function makeMinimalAdapter(
  dir: string,
  opts: { kind: 'unbuilt' | 'broken-prebuilt' | 'externalized-prebuilt'; name: string },
): Promise<void> {
  await mkdir(dir, { recursive: true })

  const workingSource = `
import { defineAdapter } from '${ADAPTER_SDK_SOURCE}'

export default defineAdapter({
  name: '${opts.name}',
  buildAssetMetadata(data) {
    return { ok: true, data: (data ?? {}) }
  },
})
`

  if (opts.kind === 'unbuilt') {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify(
        {
          name: opts.name,
          version: '0.0.1',
          type: 'module',
          exports: { '.': './src/index.ts' },
        },
        null,
        2,
      ),
    )
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src/index.ts'), workingSource)
    return
  }

  if (opts.kind === 'broken-prebuilt') {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify(
        {
          name: opts.name,
          version: '0.0.1',
          type: 'module',
          exports: { '.': { import: './dist/index.mjs' } },
        },
        null,
        2,
      ),
    )
    await mkdir(join(dir, 'dist'), { recursive: true })
    // This import cannot resolve — verifyAdapter()'s dynamic import() will throw
    // and trigger the slow-path fallback.
    await writeFile(
      join(dir, 'dist/index.mjs'),
      `import { nope } from 'this-package-does-not-exist-anywhere'\nexport default nope\n`,
    )
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src/index.ts'), workingSource)
    return
  }

  // externalized-prebuilt: dist/index.mjs imports a runtime dep that IS
  // present in the source tree's node_modules, but the bundle does NOT
  // inline it. Verifying the bundle in-place would falsely succeed (Node
  // resolution finds the dep via the source tree). Verifying it from an
  // isolated temp dir surfaces the missing external — which is exactly
  // what /the fix added in PR #142 does.
  const externalDep = 'fixture-runtime-dep'
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: opts.name,
        version: '0.0.1',
        type: 'module',
        exports: { '.': { import: './dist/index.mjs' } },
      },
      null,
      2,
    ),
  )
  await mkdir(join(dir, 'dist'), { recursive: true })
  // The published bundle imports an external. If we re-imported it in-place,
  // Node would resolve `fixture-runtime-dep` via `<sourceDir>/node_modules/`
  // — but after copy to ~/.facet/adapters/<name>/adapter.js, that lookup
  // would fail. Our isolation strategy catches that ahead of time.
  await writeFile(join(dir, 'dist/index.mjs'), `import { adapter } from '${externalDep}'\nexport default adapter\n`)
  // Plant the runtime dep in node_modules so an in-place verify would succeed.
  const depDir = join(dir, 'node_modules', externalDep)
  await mkdir(depDir, { recursive: true })
  await writeFile(
    join(depDir, 'package.json'),
    JSON.stringify({ name: externalDep, version: '1.0.0', type: 'module', main: 'index.mjs' }, null, 2),
  )
  await writeFile(
    join(depDir, 'index.mjs'),
    `export const adapter = { name: '${opts.name}', buildAssetMetadata() { return { ok: true } } }\n`,
  )
  // Working source so the slow-path fallback can rebundle.
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src/index.ts'), workingSource)
}

/**
 * Create a fresh temp `FACET_DIR` for the test. The CLI will then materialize
 * adapters into `<facetDir>/adapters/` automatically.
 */
async function makeFacetDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'facets-install-cli-test-'))
}

/** Convenience: the adapters subdirectory inside a given `FACET_DIR`. */
function adaptersIn(facetDir: string): string {
  return join(facetDir, 'adapters')
}

/**
 * Resolve the active managed bundle for an installed adapter by reading
 * its `installation.json` receipt. Managed installs place bundles at
 * `<name>/generations/<activeGeneration>/adapter.js`; the flat
 * `<name>/adapter.js` layout is legacy/unmanaged.
 */
async function activeManagedBundle(facetDir: string, name: string): Promise<string> {
  const receiptPath = join(adaptersIn(facetDir), name, 'installation.json')
  const receipt = (await Bun.file(receiptPath).json()) as { activeGeneration: string }
  return join(adaptersIn(facetDir), name, 'generations', receipt.activeGeneration, 'adapter.js')
}

beforeAll(async () => {
  // Verify the compiled binary exists — if it doesn't, the test suite can't
  // run. The turbo config declares test depends on build, but surface a
  // clearer error if somebody runs `bun test` directly without building.
  try {
    await stat(CLI_PATH)
  } catch {
    throw new Error(`CLI binary not found at ${CLI_PATH}. Run 'bun --filter=agent-facets run build' first.`)
  }
})

describe('facet adapter install — fast path from extracted npm tarball', () => {
  test('installs from a packed tarball using the prebuilt dist/index.mjs', async () => {
    const extractedDir = await packOpencode()
    const facetDir = await makeFacetDir()
    try {
      const result = await runCli(['adapter', 'install', extractedDir], { FACET_DIR: facetDir })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('using prebuilt bundle for')
      expect(result.stdout).toContain('Adapter "opencode" installed successfully.')

      // Adapter should be activated via a managed receipt + generation
      const installedBundle = await activeManagedBundle(facetDir, 'opencode')
      const stats = await stat(installedBundle)
      expect(stats.isFile()).toBe(true)

      // And should have the same content size as the packed dist/index.mjs,
      // since the fast path is a direct copy.
      const sourceBundle = join(extractedDir, 'dist/index.mjs')
      const sourceStats = await stat(sourceBundle)
      expect(stats.size).toBe(sourceStats.size)
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter install — slow path from unbuilt local source', () => {
  test('bundles from src/index.ts when no prebuilt dist exists', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'facets-install-cli-fixture-'))
    const adapterDir = join(workDir, 'my-adapter')
    const facetDir = await makeFacetDir()
    try {
      await makeMinimalAdapter(adapterDir, { kind: 'unbuilt', name: 'my-unbuilt-adapter' })

      const result = await runCli(['adapter', 'install', adapterDir], { FACET_DIR: facetDir })

      expect(result.exitCode).toBe(0)
      // Fast path is NOT used (exports pointed at .ts, classified as 'source')
      expect(result.stdout).not.toContain('Using prebuilt bundle...')
      expect(result.stdout).toContain('Adapter "my-unbuilt-adapter" installed successfully.')

      const installedBundle = await activeManagedBundle(facetDir, 'my-unbuilt-adapter')
      const stats = await stat(installedBundle)
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)
    } finally {
      await rm(workDir, { recursive: true, force: true })
      await rm(facetDir, { recursive: true, force: true })
    }
  })

  test("does not pollute the user's source tree with .facet-build artifacts", async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'facets-install-cli-fixture-'))
    const adapterDir = join(workDir, 'my-adapter')
    const facetDir = await makeFacetDir()
    try {
      await makeMinimalAdapter(adapterDir, { kind: 'unbuilt', name: 'my-clean-adapter' })

      const result = await runCli(['adapter', 'install', adapterDir], { FACET_DIR: facetDir })
      expect(result.exitCode).toBe(0)

      // The slow path must NOT write `.facet-build/` (or any other scratch
      // dir) inside the user's adapter source tree. The historical behavior
      // wrote to `<sourceDir>/.facet-build/`, which polluted local installs
      // and left build artifacts behind even after the install completed.
      await expect(stat(join(adapterDir, '.facet-build'))).rejects.toThrow()

      // Source tree should only contain the files we put there (package.json,
      // src/, plus bun's node_modules + bun.lock from `bun install`).
      const entries = await readdir(adapterDir)
      for (const entry of entries) {
        expect(entry).not.toBe('.facet-build')
      }
    } finally {
      await rm(workDir, { recursive: true, force: true })
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter install — slow-path fallback after broken prebuilt', () => {
  test('falls back to rebundling from source when the prebuilt bundle fails to load', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'facets-install-cli-fixture-'))
    const adapterDir = join(workDir, 'my-adapter')
    const facetDir = await makeFacetDir()
    try {
      await makeMinimalAdapter(adapterDir, { kind: 'broken-prebuilt', name: 'my-fallback-adapter' })

      const result = await runCli(['adapter', 'install', adapterDir], { FACET_DIR: facetDir })

      expect(result.exitCode).toBe(0)
      // Fast path is attempted then rejected — both logs should appear
      expect(result.stdout).toContain('using prebuilt bundle for')
      expect(result.stdout).toContain('did not load cleanly')
      expect(result.stdout).toContain('rebundling from source')
      expect(result.stdout).toContain('Adapter "my-fallback-adapter" installed successfully.')

      // No double resolution: the prebuilt log must appear exactly once. If
      // the slow-path dispatch erroneously called bundleAdapter() (which
      // re-runs resolveEntryPoint), a stale prebuilt could be picked again
      // and we'd see the log twice. Guards against the regression described
      // in the Cursor review for PR #142.
      const prebuiltLogCount = (result.stdout.match(/using prebuilt bundle for/g) ?? []).length
      expect(prebuiltLogCount).toBe(1)

      const installedBundle = await activeManagedBundle(facetDir, 'my-fallback-adapter')
      const stats = await stat(installedBundle)
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)
    } finally {
      await rm(workDir, { recursive: true, force: true })
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter install — externalized prebuilt (PR #142 P1 regression)', () => {
  test('rejects an in-place-verifiable prebuilt that depends on the source tree node_modules', async () => {
    // This guards against the Codex P1 from PR #142: a prebuilt bundle
    // that imports externals which happen to be present in the source
    // tree's `node_modules/` would falsely pass the old in-place
    // verification, then break later when copied to ~/.facet/adapters.
    // The fix verifies the bundle in an isolated tmpdir (no node_modules
    // siblings), so unresolved externals fail fast and we fall back to
    // the slow path.
    const workDir = await mkdtemp(join(tmpdir(), 'facets-install-cli-fixture-'))
    const adapterDir = join(workDir, 'my-adapter')
    const facetDir = await makeFacetDir()
    try {
      await makeMinimalAdapter(adapterDir, { kind: 'externalized-prebuilt', name: 'my-externalized-adapter' })

      const result = await runCli(['adapter', 'install', adapterDir], { FACET_DIR: facetDir })

      expect(result.exitCode).toBe(0)
      // The fast path is tried (the bundle looks OK from package.json's
      // POV) but isolated verification fails because `fixture-runtime-dep`
      // can't be resolved away from the source tree.
      expect(result.stdout).toContain('using prebuilt bundle for')
      expect(result.stdout).toContain('did not load cleanly')
      expect(result.stdout).toContain('rebundling from source')
      expect(result.stdout).toContain('Adapter "my-externalized-adapter" installed successfully.')

      // The placed bundle should be the rebundled (self-contained) output,
      // NOT the original dist/index.mjs. We assert by comparing sizes:
      // the rebundled file inlines `fixture-runtime-dep` so it must be
      // strictly larger than the 2-line stub in dist/index.mjs.
      const installedBundle = await activeManagedBundle(facetDir, 'my-externalized-adapter')
      const installedStats = await stat(installedBundle)
      const sourceStats = await stat(join(adapterDir, 'dist/index.mjs'))
      expect(installedStats.size).toBeGreaterThan(sourceStats.size)
    } finally {
      await rm(workDir, { recursive: true, force: true })
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter install — temp dir cleanup (PR #142 follow-up)', () => {
  test('does not leak facet-adapter-build-* dirs in tmpdir after a slow-path install', async () => {
    // Regression test for the Copilot-suppressed comment on PR #142:
    // `rebundleAdapter` creates `mkdtemp(tmpdir(), 'facet-adapter-build-')`
    // for its build output. Without an explicit cleanup, these would
    // accumulate in the OS temp directory across installs. Our fix
    // returns a `cleanup()` from rebundleAdapter and `handleInstall`
    // calls it in the finally block.
    //
    // We can't easily isolate this from other tests running in parallel
    // (they all share the same tmpdir), so we count `facet-adapter-build-*`
    // entries before and after THIS install and require the count to be
    // unchanged. Even if a sibling test creates one mid-flight, our
    // delta against this single install should be 0.
    const workDir = await mkdtemp(join(tmpdir(), 'facets-install-cli-fixture-'))
    const adapterDir = join(workDir, 'my-adapter')
    const facetDir = await makeFacetDir()
    try {
      await makeMinimalAdapter(adapterDir, { kind: 'unbuilt', name: 'cleanup-check-adapter' })

      const before = (await readdir(tmpdir())).filter((n) => n.startsWith('facet-adapter-build-'))
      const result = await runCli(['adapter', 'install', adapterDir], { FACET_DIR: facetDir })
      const after = (await readdir(tmpdir())).filter((n) => n.startsWith('facet-adapter-build-'))

      expect(result.exitCode).toBe(0)
      // The set of facet-adapter-build-* dirs created by THIS install
      // must be empty after the install completes.
      const newlyCreated = after.filter((n) => !before.includes(n))
      expect(newlyCreated).toEqual([])
    } finally {
      await rm(workDir, { recursive: true, force: true })
      await rm(facetDir, { recursive: true, force: true })
    }
  })

  test('also cleans up after the slow-path-fallback (broken-prebuilt) flow', async () => {
    // Same as above, but for the broken-prebuilt fixture which exercises
    // the prebuilt → fail → rebundle path.
    const workDir = await mkdtemp(join(tmpdir(), 'facets-install-cli-fixture-'))
    const adapterDir = join(workDir, 'my-adapter')
    const facetDir = await makeFacetDir()
    try {
      await makeMinimalAdapter(adapterDir, { kind: 'broken-prebuilt', name: 'cleanup-fallback-adapter' })

      const before = (await readdir(tmpdir())).filter((n) => n.startsWith('facet-adapter-build-'))
      const result = await runCli(['adapter', 'install', adapterDir], { FACET_DIR: facetDir })
      const after = (await readdir(tmpdir())).filter((n) => n.startsWith('facet-adapter-build-'))

      expect(result.exitCode).toBe(0)
      const newlyCreated = after.filter((n) => !before.includes(n))
      expect(newlyCreated).toEqual([])
    } finally {
      await rm(workDir, { recursive: true, force: true })
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter install + list + remove — round trip', () => {
  test('all three subcommands share the same FACET_DIR', async () => {
    const extractedDir = await packOpencode()
    const facetDir = await makeFacetDir()
    const env = { FACET_DIR: facetDir }
    try {
      // Install
      const installResult = await runCli(['adapter', 'install', extractedDir], env)
      expect(installResult.exitCode).toBe(0)

      // List — should show the adapter
      const listResult = await runCli(['adapter', 'list'], env)
      expect(listResult.exitCode).toBe(0)
      expect(listResult.stdout).toContain('opencode')
      expect(listResult.stdout).not.toContain('No adapters installed')

      // Remove
      const removeResult = await runCli(['adapter', 'remove', 'opencode'], env)
      expect(removeResult.exitCode).toBe(0)
      expect(removeResult.stdout).toContain('Adapter "opencode" removed.')

      // List again — should show empty
      const listAfterResult = await runCli(['adapter', 'list'], env)
      expect(listAfterResult.exitCode).toBe(0)
      expect(listAfterResult.stdout).toContain('No adapters installed')
      expect(listAfterResult.stdout).not.toContain('opencode')

      // Filesystem confirms
      const adapterDir = join(adaptersIn(facetDir), 'opencode')
      await expect(stat(adapterDir)).rejects.toThrow()
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter install — managed replacement', () => {
  test('reinstalling keeps exactly one active generation and updates the receipt', async () => {
    const extractedDir = await packOpencode()
    const facetDir = await makeFacetDir()
    const env = { FACET_DIR: facetDir }
    try {
      const first = await runCli(['adapter', 'install', extractedDir], env)
      expect(first.exitCode).toBe(0)
      const firstBundle = await activeManagedBundle(facetDir, 'opencode')

      const second = await runCli(['adapter', 'install', extractedDir], env)
      expect(second.exitCode).toBe(0)
      const secondBundle = await activeManagedBundle(facetDir, 'opencode')

      // A fresh generation was activated and the old one was cleaned up.
      expect(secondBundle).not.toBe(firstBundle)
      const generations = await readdir(join(adaptersIn(facetDir), 'opencode', 'generations'))
      expect(generations).toHaveLength(1)
      await expect(stat(firstBundle)).rejects.toThrow()
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter list — inspection-backed output', () => {
  test('renders API and compatibility status for a compatible install', async () => {
    const extractedDir = await packOpencode()
    const facetDir = await makeFacetDir()
    try {
      const installResult = await runCli(['adapter', 'install', extractedDir], { FACET_DIR: facetDir })
      expect(installResult.exitCode).toBe(0)

      const listResult = await runCli(['adapter', 'list'], { FACET_DIR: facetDir })
      expect(listResult.exitCode).toBe(0)
      expect(listResult.stdout).toContain('opencode')
      expect(listResult.stdout).toContain(`api ${ADAPTER_API_VERSION}`)
      expect(listResult.stdout).toContain('supported')
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })

  test('remains usable with an incompatible (undeclared) entry and shows recovery', async () => {
    const facetDir = await makeFacetDir()
    try {
      // Fabricate an unmanaged legacy bundle with no API declaration.
      const legacyDir = join(adaptersIn(facetDir), 'legacy-tool')
      await mkdir(legacyDir, { recursive: true })
      await writeFile(
        join(legacyDir, 'adapter.js'),
        `export default {
  name: 'legacy-tool',
  buildAssetMetadata: () => ({ ok: true, data: {} }),
  installAsset: async () => undefined,
  readAsset: async () => ({ content: '' }),
  deleteAsset: async () => undefined,
}`,
      )

      const listResult = await runCli(['adapter', 'list'], { FACET_DIR: facetDir })
      expect(listResult.exitCode).toBe(0)
      expect(listResult.stdout).toContain('legacy-tool')
      expect(listResult.stdout).toContain('api missing')
      expect(listResult.stdout).toContain('unsupported')
      expect(listResult.stdout).toContain('facet adapter install legacy-tool')
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })

  test('remains usable with a broken entry (invalid receipt) and shows recovery', async () => {
    const facetDir = await makeFacetDir()
    try {
      // Fabricate a managed directory whose installation.json is garbage.
      const brokenDir = join(adaptersIn(facetDir), 'broken-tool')
      await mkdir(brokenDir, { recursive: true })
      await writeFile(join(brokenDir, 'installation.json'), '{not json')

      const listResult = await runCli(['adapter', 'list'], { FACET_DIR: facetDir })
      expect(listResult.exitCode).toBe(0)
      expect(listResult.stdout).toContain('broken-tool')
      expect(listResult.stdout).toContain('api unknown')
      expect(listResult.stdout).toContain('broken (invalid installation record)')
      expect(listResult.stdout).toContain('facet adapter install broken-tool')
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('FACET_DIR redirect', () => {
  test('install writes to the env-var dir, leaving ~/.facet/adapters untouched', async () => {
    const extractedDir = await packOpencode()
    const facetDir = await makeFacetDir()
    try {
      // We don't have a safe way to snapshot the user's real ~/.facet/adapters
      // and compare before/after, so this test asserts the positive: the
      // adapter DEFINITELY lands in the temp dir. Combined with the fact that
      // every other test also uses the env var, this guards against anyone
      // accidentally changing `resolveAdapterBaseDir()` to ignore it.
      const result = await runCli(['adapter', 'install', extractedDir], { FACET_DIR: facetDir })

      expect(result.exitCode).toBe(0)

      const installedBundle = await activeManagedBundle(facetDir, 'opencode')
      const stats = await stat(installedBundle)
      expect(stats.isFile()).toBe(true)
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})

describe('facet adapter install — error handling', () => {
  test('install from a nonexistent local path exits 1 with a clear error', async () => {
    const facetDir = await makeFacetDir()
    const missingPath = join(facetDir, 'does-not-exist')
    try {
      const result = await runCli(['adapter', 'install', missingPath], { FACET_DIR: facetDir })

      expect(result.exitCode).toBe(1)
      // Error should mention the path or "does not exist" / "not an adapter"
      const combined = `${result.stdout}\n${result.stderr}`
      expect(combined.toLowerCase()).toMatch(/does not exist|not.*adapter|no such file/)

      // No adapter should have been placed
      const entries = await readdir(adaptersIn(facetDir)).catch(() => [])
      // The temp dir is empty except for any other files tests created (none)
      expect(entries.filter((e) => !e.startsWith('.'))).toEqual([])
    } finally {
      await rm(facetDir, { recursive: true, force: true })
    }
  })
})
