#!/usr/bin/env bun

/**
 * Seed library/adapter package names on npm.
 *
 * Publishes v0.0.1 placeholder packages to claim any non-private
 * `@agent-facets/*` workspace package names that don't yet exist on
 * the npm registry. Required as a one-time bootstrap before OIDC
 * trusted publishing can be configured for each package.
 *
 * CLI platform packages (`@agent-facets/cli-*`) and the CLI wrapper
 * (`agent-facets`) are excluded — they are seeded by
 * `scripts/release-cli/seed.ts`.
 *
 * Requires manual `npm login`. After publishing, prints OIDC setup
 * instructions for each seeded package.
 *
 * Usage: bun seed:adapters (or bun scripts/release/seed-adapters.ts)
 */

import { loadWorkspacePackages } from '../lib/ci'
import { packageExists, publishPlaceholder, whoami } from '../lib/npm'
import { printOidcInstructions } from '../lib/seed-oidc'

function log(msg: string) {
  console.log(msg)
}

/**
 * Decide which workspace packages are owned by this seed script. We
 * include any non-private `@agent-facets/*` package EXCEPT the CLI
 * platform packages and the CLI wrapper — those are seeded separately
 * by `scripts/release-cli/seed.ts`.
 */
function isAdapterSeedTarget(pkg: { name: string; private?: boolean }): boolean {
  if (pkg.private) return false
  if (!pkg.name.startsWith('@agent-facets/')) return false
  if (pkg.name.startsWith('@agent-facets/cli-')) return false
  return true
}

async function main() {
  log('\n=== Seed Adapter/Library Packages ===\n')

  // 1. Check npm login
  const user = await whoami()
  if (!user) {
    log('   You need to be logged in to npm to publish placeholders.')
    log('   Run `npm login` first, then re-run `bun seed:adapters`.')
    process.exit(1)
  }
  log(`   Logged in to npm as: ${user}`)

  // 2. Discover target packages from the workspace
  const packages = await loadWorkspacePackages()
  const targets = packages.filter(isAdapterSeedTarget).map((p) => p.name)
  log(`\n   Discovered ${targets.length} adapter/library packages. Checking npm registry...`)
  for (const name of targets) log(`     • ${name}`)

  if (targets.length === 0) {
    log('\n   No seed targets found. Nothing to do.')
    process.exit(0)
  }

  // 3. Check which packages already exist (parallel)
  const results = await Promise.all(
    targets.map(async (pkg) => ({
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
    printOidcInstructions(targets)
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
      log('\n   Fix the error and re-run `bun seed:adapters`.')
      process.exit(1)
    }
  }

  // 5. Print OIDC setup instructions
  log('\n   Placeholder packages published successfully!')
  printOidcInstructions(seeded)
  log('\n   Run `bun seed:adapters` again after configuring OIDC to verify all packages exist.')
}

main().catch((err) => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
