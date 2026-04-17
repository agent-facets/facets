#!/usr/bin/env bun

/**
 * Seed platform package names on npm.
 *
 * Publishes v0.0.1 placeholder packages under @agent-facets/cli-* to claim
 * the 12 platform package names. Requires manual `npm login`. After publishing,
 * prints OIDC setup instructions for each seeded package.
 *
 * Usage: bun seed (or bun scripts/release-cli/seed.ts)
 */

import { packageExists, publishPlaceholder, whoami } from '../lib/npm'
import { printOidcInstructions } from '../lib/seed-oidc'
import { allTargets, packageName } from './targets'

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(msg)
}

async function main() {
  log('\n=== Seed Platform Packages ===\n')

  // 1. Check npm login
  const user = await whoami()
  if (!user) {
    log('   You need to be logged in to npm to publish placeholders.')
    log('   Run `npm login` first, then re-run `bun seed`.')
    process.exit(1)
  }
  log(`   Logged in to npm as: ${user}`)

  // 2. Discover expected package names from the target matrix
  const expected = allTargets.map(packageName)
  log(`\n   Discovered ${expected.length} platform packages. Checking npm registry...`)

  // 3. Check which packages already exist (parallel)
  const results = await Promise.all(
    expected.map(async (pkg) => ({
      pkg,
      exists: await packageExists(pkg),
    })),
  )

  const missing = results.filter((r) => !r.exists).map((r) => r.pkg)
  const existing = results.filter((r) => r.exists).map((r) => r.pkg)

  if (existing.length > 0) {
    log(`\n   Already on npm (${existing.length}):`)
    for (const pkg of existing) log(`     ✓ ${pkg}`)
  }

  if (missing.length === 0) {
    log('\n   All packages already exist on npm. Nothing to seed.')
    log('\n   If you still need to configure OIDC:')
    printOidcInstructions(expected)
    process.exit(0)
  }

  // 4. Publish placeholders for missing packages
  log(`\n   Publishing ${missing.length} placeholder packages...\n`)

  const seeded: string[] = []
  for (const pkg of missing) {
    try {
      await publishPlaceholder(pkg)
      log(`   + ${pkg}@0.0.1`)
      seeded.push(pkg)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('previously published versions')) {
        log(`   ~ ${pkg}@0.0.1 (already published, skipping)`)
        continue
      }
      console.error(`   ✗ Failed to publish ${pkg}:`, msg)
      log('\n   Fix the error and re-run `bun seed`.')
      process.exit(1)
    }
  }

  // 5. Print OIDC setup instructions
  log('\n   Placeholder packages published successfully!')
  printOidcInstructions(seeded)
  log('\n   Run `bun seed` again after configuring OIDC to verify all packages exist.')
}

main().catch((err) => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
