#!/usr/bin/env bun

/**
 * Verify CLI platform packages exist in the npm registry.
 *
 * Checks that all 12 platform packages and the wrapper package exist
 * at the expected version. Retries with exponential backoff to handle
 * npm registry propagation delay.
 *
 * Usage: bun scripts/verify-cli.ts <version>
 */

import { allTargets, CLI_WRAPPER_NAME, packageName } from './lib/build-cli'
import { versionExists } from './lib/npm'

const MAX_RETRIES = 5
const INITIAL_DELAY_MS = 1_000

function allPackageNames(): string[] {
  return [...allTargets.map(packageName), CLI_WRAPPER_NAME]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function verify(version: string, initialDelayMs = INITIAL_DELAY_MS): Promise<number> {
  const packages = allPackageNames()
  let pending = new Set(packages)

  console.log(`\n=== Verify CLI Packages ===`)
  console.log(`\n   Checking ${packages.length} packages at version ${version}...\n`)

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
      console.log(`\n=== All ${packages.length} packages verified ===`)
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
    console.error('Usage: bun scripts/verify-cli.ts <version>')
    process.exit(1)
  }
  const code = await verify(version)
  process.exit(code)
}
