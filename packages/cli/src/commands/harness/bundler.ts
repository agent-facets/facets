import { join } from 'node:path'

/**
 * Bundles a harness source directory into a self-contained harness.js file.
 *
 * Steps:
 * 1. Run `bun install` in the source directory to install dependencies
 * 2. Run `Bun.build()` on the entry point to produce a single bundled .js file
 *
 * @param sourceDir - Path to the harness source (must contain package.json)
 * @returns Path to the built harness.js file
 */
export async function bundleHarness(sourceDir: string): Promise<string> {
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

  // Step 2: Determine entry point
  const entryPoint = await resolveEntryPoint(sourceDir)

  // Step 3: Bundle with Bun.build()
  const outdir = join(sourceDir, '.facet-build')
  const buildResult = await Bun.build({
    entrypoints: [entryPoint],
    outdir,
    target: 'bun',
    format: 'esm',
  })

  if (!buildResult.success) {
    const errors = buildResult.logs.map((l) => l.message).join('\n')
    throw new Error(`Failed to bundle harness from "${sourceDir}":\n${errors}`)
  }

  // The output file should be at .facet-build/index.js (or similar)
  const outputFile = buildResult.outputs[0]
  if (!outputFile) {
    throw new Error(`Bun.build() produced no output for "${sourceDir}"`)
  }

  return outputFile.path
}

/**
 * Resolves the entry point for a harness package.
 * Reads package.json to find the exports/main field.
 */
async function resolveEntryPoint(sourceDir: string): Promise<string> {
  const pkgJsonPath = join(sourceDir, 'package.json')
  const pkgFile = Bun.file(pkgJsonPath)

  if (!(await pkgFile.exists())) {
    throw new Error(`No package.json found in "${sourceDir}"`)
  }

  const pkg = (await pkgFile.json()) as {
    exports?: Record<string, string> | string
    main?: string
  }

  // Check exports["."] first, then main
  let entry: string | undefined
  if (typeof pkg.exports === 'string') {
    entry = pkg.exports
  } else if (pkg.exports && typeof pkg.exports['.'] === 'string') {
    entry = pkg.exports['.']
  } else if (pkg.main) {
    entry = pkg.main
  }

  if (!entry) {
    // Default fallback: try src/index.ts
    const defaultEntry = join(sourceDir, 'src/index.ts')
    if (await Bun.file(defaultEntry).exists()) {
      return defaultEntry
    }
    throw new Error(
      `Cannot determine entry point for harness in "${sourceDir}". Set "exports" or "main" in package.json.`,
    )
  }

  return join(sourceDir, entry)
}
