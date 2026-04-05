/**
 * Cross-compilation build script for the `agent-facets` CLI.
 *
 * Produces standalone Bun-compiled binaries for 12 platform/arch/ABI targets.
 *
 * Usage:
 *   bun scripts/build-cli.ts                      # Build all 12 targets
 *   bun scripts/build-cli.ts --single             # Build for the current platform only
 *   bun scripts/build-cli.ts --single --baseline  # Build baseline variant for the current platform
 */

import { resolve } from 'node:path'
import { $ } from 'bun'
import {
  allTargets,
  buildPackageJson,
  bunTarget,
  filterTargets,
  outfilePath,
  packageJsonPath,
  packageName,
  shouldSmokeTest,
} from './lib/build-cli.ts'

const cliDir = resolve(import.meta.dir, '..', 'packages', 'cli')
const pkg = await Bun.file(resolve(cliDir, 'package.json')).json()
const version: string = pkg.version

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const singleFlag = process.argv.includes('--single')
const baselineFlag = process.argv.includes('--baseline')

const targets = filterTargets(allTargets, {
  single: singleFlag,
  baseline: baselineFlag,
  platform: process.platform,
  arch: process.arch,
})

if (targets.length === 0) {
  console.error(`No matching targets for ${process.platform}/${process.arch}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Build loop
// ---------------------------------------------------------------------------

console.log(`Building ${targets.length} target(s) — version ${version}\n`)

for (const item of targets) {
  const name = packageName(item)
  const target = bunTarget(name)
  const outfile = outfilePath(cliDir, name)

  console.log(`  Building ${name} (${target})...`)

  const result = await Bun.build({
    entrypoints: [resolve(cliDir, 'src', 'index.ts')],
    compile: {
      target: target as Bun.Build.CompileTarget,
      outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
    },
  })

  if (!result.success) {
    console.error(`  Build failed for ${name}:`)
    for (const log of result.logs) {
      console.error(`    ${log}`)
    }
    process.exit(1)
  }

  const pkgJson = buildPackageJson(name, version, item)
  await Bun.file(packageJsonPath(cliDir, name)).write(`${JSON.stringify(pkgJson, null, 2)}\n`)

  console.log(`  ✓ ${name}`)

  if (shouldSmokeTest(item, process.platform, process.arch)) {
    console.log(`  Running smoke test: ${outfile} --version`)
    try {
      const versionOutput = await $`${outfile} --version`.text()
      console.log(`  ✓ Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`  ✗ Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }
}

console.log(`\nDone — ${targets.length} target(s) built.`)
