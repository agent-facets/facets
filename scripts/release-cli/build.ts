/**
 * Cross-compilation build script for the `agent-facets` CLI.
 *
 * Produces standalone Bun-compiled binaries for 12 platform/arch/ABI targets.
 *
 * Usage:
 *   bun scripts/release-cli/build.ts                      # Build all 12 targets
 *   bun scripts/release-cli/build.ts --single             # Build for the current platform only
 *   bun scripts/release-cli/build.ts --single --baseline  # Build baseline variant for the current platform
 *   bun scripts/release-cli/build.ts --target darwin-arm64 # Build a specific target by name
 */

import { resolve } from 'node:path'
import { $ } from 'bun'
import {
  allTargets,
  buildTargetPackageJson,
  bunTarget,
  filterTargets,
  outfilePath,
  packageJsonPath,
  packageName,
  shouldSmokeTest,
} from './targets'

const cliDir = resolve(import.meta.dir, '..', '..', 'packages', 'cli')
const pkg = await Bun.file(resolve(cliDir, 'package.json')).json()
const version: string = pkg.version

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const singleFlag = process.argv.includes('--single')
const baselineFlag = process.argv.includes('--baseline')
const targetIndex = process.argv.indexOf('--target')
const targetFlag = targetIndex !== -1 ? process.argv[targetIndex + 1] : undefined

const targets = filterTargets(allTargets, {
  single: singleFlag,
  baseline: baselineFlag,
  target: targetFlag,
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

for (const target of targets) {
  const name = packageName(target)
  const targetName = bunTarget(name)
  const outfile = outfilePath(cliDir, name)

  console.log(`  Building ${name} (${targetName})...`)

  const result = await Bun.build({
    entrypoints: [resolve(cliDir, 'src', 'index.ts')],
    compile: {
      target: targetName,
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

  const pkgJson = buildTargetPackageJson(name, version, target)
  await Bun.file(packageJsonPath(cliDir, name)).write(`${JSON.stringify(pkgJson, null, 2)}\n`)

  console.log(`  ✓ ${name}`)

  if (shouldSmokeTest(target, process.platform, process.arch)) {
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
