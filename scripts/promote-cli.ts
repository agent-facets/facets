#!/usr/bin/env bun

/**
 * Promote CLI platform packages from staging to latest.
 *
 * Flips the `latest` dist-tag for all 12 platform packages and the
 * wrapper package. Idempotent — skips packages where `latest` already
 * points to the target version.
 *
 * Usage: bun scripts/promote-cli.ts <version>
 */

import { allTargets, CLI_WRAPPER_NAME, packageName } from './lib/build-cli'
import { distTagAdd, latestVersion } from './lib/npm'

function allPackageNames(): string[] {
  return [...allTargets.map(packageName), CLI_WRAPPER_NAME]
}

export async function promote(version: string): Promise<number> {
  const packages = allPackageNames()
  let promoted = 0
  let skipped = 0
  let failed = 0

  console.log(`\n=== Promote CLI Packages ===`)
  console.log(`\n   Promoting ${packages.length} packages to latest@${version}...\n`)

  for (const pkg of packages) {
    const current = await latestVersion(pkg)

    if (current === version) {
      console.log(`   ~ ${pkg} (latest already at ${version}, skipping)`)
      skipped++
      continue
    }

    try {
      await distTagAdd(pkg, version, 'latest')
      console.log(`   ✓ ${pkg}@${version} → latest`)
      promoted++
    } catch (err) {
      console.error(`   ✗ ${pkg}@${version} — failed: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\n   Promoted: ${promoted}, Skipped: ${skipped}, Failed: ${failed}`)

  if (failed > 0) {
    console.error(`\n   ${failed} package(s) failed to promote. Re-run to retry.`)
    return 1
  }

  console.log(`\n=== All packages promoted to latest ===`)
  return 0
}

if (import.meta.main) {
  const version = process.argv[2]
  if (!version) {
    console.error('Usage: bun scripts/promote-cli.ts <version>')
    process.exit(1)
  }
  const code = await promote(version)
  process.exit(code)
}
