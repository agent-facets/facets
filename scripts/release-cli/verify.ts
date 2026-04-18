#!/usr/bin/env bun

/**
 * Verify packages exist in the npm registry.
 *
 * Checks that the given packages exist at the expected version. Retries with
 * exponential backoff to handle npm registry propagation delay.
 *
 * Usage:
 *   bun scripts/release-cli/verify.ts <version>
 *   bun scripts/release-cli/verify.ts <version> <pkg1,pkg2,...>
 *
 * If no package list is provided, defaults to all 13 CLI packages
 * (12 platform binaries + the CLI wrapper) for standalone auditing.
 */

import { versionExists } from '../lib/npm'
import { allPackageNames } from './targets'

const MAX_RETRIES = 5
const INITIAL_DELAY_MS = 1_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function verify(packages: string[], version: string, initialDelayMs = INITIAL_DELAY_MS): Promise<number> {
  let pending = new Set(packages)

  console.log(`\n=== Verify Packages ===`)
  console.log(`\n   Checking ${packages.length} package(s) at version ${version}...\n`)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = initialDelayMs * 2 ** (attempt - 1)
      console.log(`   Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`)
      await sleep(delay)
    }

    const stillPending = new Set<string>()

    for (const pkg of pending) {
      if (await versionExists(pkg, version)) {
        console.log(`   ✓ ${pkg}@${version}`)
      } else {
        stillPending.add(pkg)
      }
    }

    pending = stillPending

    if (pending.size === 0) {
      console.log(`\n=== All ${packages.length} package(s) verified ===`)
      return 0
    }

    if (attempt < MAX_RETRIES) {
      console.log(`   ${pending.size} package(s) not yet visible...`)
    }
  }

  console.error(`\n   Failed to verify ${pending.size} package(s):`)
  for (const pkg of pending) {
    console.error(`   ✗ ${pkg}@${version}`)
  }

  return 1
}

if (import.meta.main) {
  const version = process.argv[2]
  if (!version) {
    console.error('Usage: bun scripts/release-cli/verify.ts <version> [pkg1,pkg2,...]')
    process.exit(1)
  }
  const packagesArg = process.argv[3]
  const packages = packagesArg ? packagesArg.split(',').filter(Boolean) : allPackageNames()
  const code = await verify(packages, version)
  process.exit(code)
}
