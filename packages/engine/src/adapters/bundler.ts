import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The result of building (or locating) an adapter bundle. Includes the
 * absolute path to the bundle and a `cleanup` function that removes any
 * temp directory the build created. Callers MUST invoke `cleanup()` after
 * they're done consuming `bundlePath` (typically in a `finally` block).
 *
 * The fast path returns a no-op `cleanup` since `bundlePath` points at
 * a file inside the source tree (or inside the source-tree temp dir,
 * which has its own cleanup lifecycle).
 */
export type BundleResult = {
  bundlePath: string
  cleanup: () => Promise<void>
}

/** A no-op cleanup, used when the fast path needs no temp dir. */
const noopCleanup = async (): Promise<void> => {}

/**
 * Produces an adapter bundle path the CLI can install.
 *
 * Adapters SHOULD ship a pre-built, fully self-contained ESM bundle at
 * `dist/index.mjs` (produced by `tsdown` with `noExternal` covering all
 * runtime deps). When that bundle is present, the fast path simply locates
 * and returns it — no `bun install`, no re-bundling, no network I/O.
 *
 * When the fast path is not available (e.g. a third-party adapter with no
 * prebuilt dist, a local source tree during development, a git install
 * without committed build output), the slow path kicks in: run `bun install`
 * in the source directory and re-bundle the resolved entry point with
 * `Bun.build()`.
 *
 * @param sourceDir - Path to the adapter source (must contain package.json)
 * @returns A `BundleResult` with the bundle path and a cleanup function.
 */
export async function bundleAdapter(sourceDir: string): Promise<BundleResult> {
  const resolved = await resolveEntryPoint(sourceDir)

  // Fast path: adapter ships a prebuilt bundle. Return it directly — no
  // install, no build. Verify step will dynamically import() it to confirm
  // it loads without missing externals; if that fails, the caller will fall
  // back to the slow path via `rebundleAdapter`.
  if (resolved.kind === 'prebuilt') {
    return { bundlePath: resolved.path, cleanup: noopCleanup }
  }

  // Slow path: source tree (e.g. unbuilt local adapter). Run `bun install`
  // and re-bundle with Bun.build().
  return rebundleAdapter(sourceDir, resolved.path)
}

/**
 * Slow path: install dependencies in `sourceDir` and bundle `entryPoint`
 * into a self-contained .js file.
 *
 * The bundle output is written to a fresh `mkdtemp` directory (NOT inside
 * `sourceDir`), so local installs from a user's source tree don't leave
 * build artifacts behind. Returns the bundle path along with a `cleanup`
 * function that removes the temp directory; callers MUST invoke `cleanup()`
 * after consuming the bundle (typically in a `finally` block) so we don't
 * accumulate `facet-adapter-build-*` dirs in the OS temp directory.
 *
 * Exported separately so callers can also invoke it as a retry fallback
 * when the fast path's prebuilt bundle fails to load (e.g. missing
 * externals, truncated file).
 */
export async function rebundleAdapter(sourceDir: string, entryPoint: string): Promise<BundleResult> {
  // Step 1: Install dependencies
  const installResult = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
    cwd: sourceDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // If frozen-lockfile fails (no lockfile), try without it
  if (installResult.exitCode !== 0) {
    const retryResult = Bun.spawnSync(['bun', 'install'], {
      cwd: sourceDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (retryResult.exitCode !== 0) {
      throw new Error(`Failed to install dependencies in "${sourceDir}": ${retryResult.stderr.toString().trim()}`)
    }
  }

  // Step 2: Bundle with Bun.build() into a fresh temp directory. Writing
  // outside of `sourceDir` keeps local installs from polluting the user's
  // source tree.
  const outdir = await mkdtemp(join(tmpdir(), 'facet-adapter-build-'))
  const cleanup = async (): Promise<void> => {
    await rm(outdir, { recursive: true, force: true }).catch(() => {})
  }

  let buildResult: Awaited<ReturnType<typeof Bun.build>>
  try {
    buildResult = await Bun.build({
      entrypoints: [entryPoint],
      outdir,
      target: 'bun',
      format: 'esm',
    })
  } catch (err) {
    // If Bun.build itself throws (rare — usually it returns a result with
    // success: false), make sure we don't leak the outdir.
    await cleanup()
    throw err
  }

  if (!buildResult.success) {
    await cleanup()
    const errors = buildResult.logs.map((l) => l.message).join('\n')
    throw new Error(`Failed to bundle adapter from "${sourceDir}":\n${errors}`)
  }

  const outputFile = buildResult.outputs[0]
  if (!outputFile) {
    await cleanup()
    throw new Error(`Bun.build() produced no output for "${sourceDir}"`)
  }

  return { bundlePath: outputFile.path, cleanup }
}

/**
 * Classification of the resolved entry point:
 *   - `prebuilt`: points at a `.mjs`/`.js` file — assume it's ready to load.
 *   - `source`: points at a TypeScript source or an unbuilt entry —
 *     must go through the slow path (install + build).
 */
export type ResolvedEntryPoint = {
  path: string
  kind: 'prebuilt' | 'source'
}

/** Classify a resolved path by its file extension. */
function classify(path: string): 'prebuilt' | 'source' {
  return path.endsWith('.mjs') || path.endsWith('.js') || path.endsWith('.cjs') ? 'prebuilt' : 'source'
}

/**
 * Resolves the entry point for an adapter package.
 *
 * Resolution order (first match wins):
 *   1. `exports` as a string.
 *   2. `exports["."]` as a string.
 *   3. `exports["."]` as an object with a string `import` field.
 *   4. `main` as a string.
 *   5. Disk fallback: `dist/index.mjs`.
 *   6. Disk fallback: `dist/index.js`.
 *   7. Disk fallback: `src/index.ts` (unbuilt local source).
 *   8. Throws, listing every location that was tried.
 *
 * Exported for direct unit testing.
 */
export async function resolveEntryPoint(sourceDir: string): Promise<ResolvedEntryPoint> {
  const pkgJsonPath = join(sourceDir, 'package.json')
  const pkgFile = Bun.file(pkgJsonPath)

  if (!(await pkgFile.exists())) {
    throw new Error(`No package.json found in "${sourceDir}"`)
  }

  const pkg = (await pkgFile.json()) as {
    exports?: string | { '.'?: string | { import?: string } }
    main?: string
  }

  const tried: string[] = []

  // 1. `exports` as a string
  if (typeof pkg.exports === 'string') {
    const absolute = join(sourceDir, pkg.exports)
    tried.push(`exports: "${pkg.exports}"`)
    if (await Bun.file(absolute).exists()) {
      return { path: absolute, kind: classify(absolute) }
    }
  }

  // 2. `exports["."]` as a string
  if (pkg.exports && typeof pkg.exports === 'object' && typeof pkg.exports['.'] === 'string') {
    const relative = pkg.exports['.']
    const absolute = join(sourceDir, relative)
    tried.push(`exports["."]: "${relative}"`)
    if (await Bun.file(absolute).exists()) {
      return { path: absolute, kind: classify(absolute) }
    }
  }

  // 3. `exports["."]` as an object with a string `import` field
  if (
    pkg.exports &&
    typeof pkg.exports === 'object' &&
    typeof pkg.exports['.'] === 'object' &&
    pkg.exports['.'] &&
    typeof pkg.exports['.'].import === 'string'
  ) {
    const relative = pkg.exports['.'].import
    const absolute = join(sourceDir, relative)
    tried.push(`exports["."].import: "${relative}"`)
    if (await Bun.file(absolute).exists()) {
      return { path: absolute, kind: classify(absolute) }
    }
  }

  // 4. `main` as a string
  if (typeof pkg.main === 'string') {
    const absolute = join(sourceDir, pkg.main)
    tried.push(`main: "${pkg.main}"`)
    if (await Bun.file(absolute).exists()) {
      return { path: absolute, kind: classify(absolute) }
    }
  }

  // 5-7. Disk fallbacks in order
  const diskFallbacks = ['dist/index.mjs', 'dist/index.js', 'src/index.ts']
  for (const relative of diskFallbacks) {
    const absolute = join(sourceDir, relative)
    tried.push(`disk: "${relative}"`)
    if (await Bun.file(absolute).exists()) {
      return { path: absolute, kind: classify(absolute) }
    }
  }

  throw new Error(
    `Cannot determine entry point for adapter in "${sourceDir}". ` +
      `Tried:\n  - ${tried.join('\n  - ')}\n` +
      `Set "exports" or "main" in package.json, or ship a prebuilt dist/index.mjs.`,
  )
}
