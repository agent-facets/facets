import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'

/**
 * Tests for the `facet remove` orchestrator (`runRemove`).
 *
 * Each test first seeds project state by running `runAdd` (which installs a
 * facet, writing the manifest, lockfile, and materialized assets) and then
 * exercises `runRemove`. The registry resolve + download path is stubbed via
 * `mock.module` exactly as in run-add.test.ts so no live registry is needed;
 * everything downstream (build, content-hash, materialize, drift-removal,
 * lockfile) runs for real.
 */

// --- Registry mock state (mutated per-test before calling runAdd) ---------

let registryFixtureDir: string | null = null
let registryResolvedVersion = '0.1.1'

/** Build the fixture's genuine build manifest — the same artifact a real
 *  registry would serve in the outer tar. The chain's hash checks (B/C,
 *  the post-download recompute) run for real against it. */
async function manifestFor(fixtureDir: string) {
  const { runBuildPipeline } = await import('../../build/pipeline.ts')
  const built = await runBuildPipeline(fixtureDir, [])
  if (!built.ok) throw new Error('test bug: fixture failed to build')
  return JSON.parse(built.manifestJson) as import('@agent-facets/protocol').BuildManifest
}

mock.module('../../registry/resolve-metadata.ts', () => ({
  resolveRegistryMetadataBatch: async (specs: ReadonlyArray<{ name: string }>) => {
    const contentFingerprint =
      registryFixtureDir === null ? 'sha256:stub' : (await manifestFor(registryFixtureDir)).integrity
    return {
      ok: true,
      value: specs.map((s) => ({
        name: s.name,
        version: registryResolvedVersion,
        transportHash: 'sha256:stub',
        contentFingerprint,
      })),
    }
  },
}))

mock.module('../../registry/download.ts', () => ({
  downloadAndExtractFacet: async (_meta: { name: string }, dest: string) => {
    if (registryFixtureDir === null) {
      return { ok: false, error: { code: 'NETWORK_ERROR', cause: 'no fixture set', attempts: 1 } }
    }
    cpSync(registryFixtureDir, dest, { recursive: true })
    return { ok: true, value: await manifestFor(registryFixtureDir) }
  },
}))

// Imported AFTER the mocks are registered so run-install picks up the stubs.
const { runAdd } = await import('../run-add.ts')
const { runRemove, prepareRemove } = await import('../run-remove.ts')
const { parseFacetSource } = await import('../../sources/facet/parse-source.ts')
const { loadInstalledAdapters } = await import('../../adapters/loader.ts')

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined
let adaptersDir: string

/** Build a facet fixture directory (a `facet.json` + one skill). */
function buildFixture(parent: string, name: string, version: string): string {
  const repo = realpathSync(mkdtempSync(join(parent, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({ name, version, skills: { [name]: { description: `${name} skill` } } }),
  )
  mkdirSync(join(repo, `skills/${name}`), { recursive: true })
  writeFileSync(join(repo, `skills/${name}/SKILL.md`), `# ${name} ${version}\n`)
  return repo
}

function installFakeAdapter(baseDir: string, name: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  const assetFsImport = require.resolve('@agent-facets/adapter')
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { installAssetFile, readAssetFile, deleteAssetFile } from '${assetFsImport}'
import { join } from 'node:path'
function path(type, name) { return join(process.cwd(), '.${name}', type + 's', name + '.md') }
export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(scope, type, name, content, metadata) { await installAssetFile({ file: path(type, name) }, content, metadata) },
  async readAsset(scope, type, name) { return readAssetFile({ file: path(type, name) }) },
  async deleteAsset(scope, type, name) { await deleteAssetFile({ file: path(type, name) }) },
}
`,
  )
}

function readFacets(): Record<string, string> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets
}

function readLockfileFacets(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).facets
}

function assetPath(adapter: string, facet: string): string {
  // Mirrors the fake adapter's path(): .<adapter>/skills/<facet>.md
  return join(projectRoot, `.${adapter}`, 'skills', `${facet}.md`)
}

async function installFacet(name: string, version: string): Promise<void> {
  registryResolvedVersion = version
  registryFixtureDir = buildFixture(fakeHome, name, version)
  const parsed = parseFacetSource(`${name}@${version}`)
  if (!parsed.ok) throw new Error(`test bug: unparseable specifier ${name}@${version}`)
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) throw new Error('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters.filter((a) => a.supportsInstall === true)
  const result = await runAdd({
    projectRoot,
    sources: [{ specifier: `${name}@${version}`, source: parsed.value }],
    adapters,
  })
  if (!result.ok) throw new Error(`test bug: failed to seed facet ${name}`)
}

async function remove(names: string[]) {
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) throw new Error('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters.filter((a) => a.supportsInstall === true)
  return runRemove({ projectRoot, names, adapters })
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-runremove-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
  installFakeAdapter(adaptersDir, 'test-adapter')
  registryFixtureDir = null
  registryResolvedVersion = '0.1.1'
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('runRemove — single-facet removal', () => {
  test('removes the facet from manifest, lockfile, and adapter', async () => {
    await installFacet('cowsay', '0.1.1')
    expect(readFacets().cowsay).toBe('0.1.1')
    expect(readLockfileFacets().cowsay).toBeDefined()
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    expect(readFacets().cowsay).toBeUndefined()
    expect(readLockfileFacets().cowsay).toBeUndefined()
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(false)
    // The removed facet is surfaced as a `removed` outcome.
    expect(result.install.perFacet.some((o) => o.kind === 'removed' && o.name === 'cowsay')).toBe(true)
  })
})

describe('runRemove — multi-facet removal', () => {
  test('removes all named facets in one operation', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('fortune', '0.2.0')

    const result = await remove(['cowsay', 'fortune'])
    expect(result.ok).toBe(true)

    expect(readFacets().cowsay).toBeUndefined()
    expect(readFacets().fortune).toBeUndefined()
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(false)
    expect(existsSync(assetPath('test-adapter', 'fortune'))).toBe(false)
  })

  test('leaves other facets intact', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('fortune', '0.2.0')

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(true)

    expect(readFacets().cowsay).toBeUndefined()
    expect(readFacets().fortune).toBe('0.2.0')
    expect(readLockfileFacets().fortune).toBeDefined()
    expect(existsSync(assetPath('test-adapter', 'fortune'))).toBe(true)
  })

  test('absent names are silently ignored — only declared facets are removed', async () => {
    await installFacet('cowsay', '0.1.1')

    const result = await remove(['cowsay', 'does-not-exist'])
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    // cowsay was removed; does-not-exist was silently ignored.
    expect(Object.keys(readFacets())).not.toContain('cowsay')
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(false)
  })
})

describe('runRemove — undeclared facet', () => {
  test('removing only undeclared facets succeeds as a no-op', async () => {
    await installFacet('cowsay', '0.1.1')
    const beforeFacets = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    const result = await remove(['ghost'])
    expect(result.ok).toBe(true)

    // Nothing was removed — cowsay is still installed.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(beforeFacets)
  })

  test('fails with manifest-read when no facets.json exists', async () => {
    // Fresh project root, no facets.json written.
    const result = await remove(['anything'])
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (result.phase !== 'prepare') expect.unreachable()
    expect(result.failure.reason).toBe('manifest-read')
  })
})

describe('runRemove — last facet', () => {
  test('removing the only facet leaves an empty manifest and valid empty lockfile', async () => {
    await installFacet('cowsay', '0.1.1')

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(true)

    expect(Object.keys(readFacets())).toHaveLength(0)
    expect(Object.keys(readLockfileFacets())).toHaveLength(0)
    // Lockfile is still structurally valid (declares a version).
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(1)
  })
})

describe('prepareRemove — read-only validation', () => {
  test('filters out undeclared names without mutating disk', async () => {
    await installFacet('cowsay', '0.1.1')
    const beforeFacets = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    const beforeLock = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')

    const result = prepareRemove({ projectRoot, names: ['ghost'] })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    // ghost is absent — filtered out; names list is empty.
    expect(result.names).toEqual([])

    // Pure validation: nothing on disk changed.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(beforeFacets)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(beforeLock)
  })

  test('filters absent names and keeps only declared ones', async () => {
    await installFacet('cowsay', '0.1.1')

    const result = prepareRemove({ projectRoot, names: ['cowsay', 'ghost', 'phantom'] })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    // Only cowsay is declared; ghost and phantom are filtered out.
    expect(result.names).toEqual(['cowsay'])
  })

  test('returns manifest-read when no facets.json exists', () => {
    // Fresh project root, no facets.json written.
    const result = prepareRemove({ projectRoot, names: ['anything'] })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('manifest-read')
  })

  test('returns the parsed manifest and filtered names when every name is declared', async () => {
    await installFacet('cowsay', '0.1.1')

    const result = prepareRemove({ projectRoot, names: ['cowsay'] })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.json.facets.cowsay).toBe('0.1.1')
    // Filtered names contains every requested name (all declared).
    expect(result.names).toEqual(['cowsay'])
  })
})

describe('runRemove — install-failure leaves manifest unchanged', () => {
  test('facets.json, facets.lock, and the receipt are untouched when install fails', async () => {
    await installFacet('cowsay', '0.1.1')
    const { receiptPath } = await import('../receipt.ts')
    const before = {
      facets: readFileSync(join(projectRoot, 'facets.json'), 'utf8'),
      lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'),
      receipt: readFileSync(receiptPath(projectRoot), 'utf8'),
    }

    // Force a runInstall failure: hold the install lock so runRemove's
    // runInstall call fails with LOCK_HELD. With the delta-based flow,
    // the manifest is never written ahead — it stays untouched on failure.
    const { acquireInstallLock } = await import('../lockfile-guard.ts')
    const lock = acquireInstallLock(projectRoot)
    if (!lock.ok) expect.unreachable()

    try {
      const result = await remove(['cowsay'])
      expect(result.ok).toBe(false)
      if (result.ok) expect.unreachable()
      expect(result.phase).toBe('install')
    } finally {
      await lock.lock.release()
    }

    // All three project files unchanged: the delta-based flow never
    // writes ahead of install — they are only written together on success.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before.facets)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(before.lock)
    expect(readFileSync(receiptPath(projectRoot), 'utf8')).toBe(before.receipt)
  })
})
