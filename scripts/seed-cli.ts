#!/usr/bin/env bun

/**
 * Seed platform package names on npm.
 *
 * Publishes v0.0.1 placeholder packages under @agent-facets/cli-* to claim
 * the 12 platform package names. Requires manual `npm login`. After publishing,
 * prints OIDC setup instructions for each seeded package.
 *
 * Usage: bun seed (or bun scripts/seed-cli.ts)
 */

import { packageExists, publishPlaceholder, whoami } from './lib/npm'
import { allTargets, packageName } from './lib/target'

// ---------------------------------------------------------------------------
// CircleCI OIDC configuration for npm trusted publishing
// ---------------------------------------------------------------------------

const CIRCLECI = {
  organizationId: 'd6dfd694-6b06-4d51-a5bd-a15b3efe977b',
  projectId: 'c7b3dd0a-e9b0-4e95-8345-fc984443e02b',
  pipelineDefinitionId: 'd404b478-dd19-4c68-891f-4cf97396b1a7',
  contextIds: '84962527-275c-495e-83c3-31c79cf1e181',
  vcsOrigin: 'github.com/agent-facets/facets',
}
const OIDC_SETUP_GUIDE = 'OIDC-SETUP.md'

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(msg)
}

function printOidcInstructions(packages: string[]) {
  log('\n   Configure OIDC trusted publishing for each new package.')
  log("   Go to each package's npm access page and add CircleCI as a trusted publisher:")
  log('')
  log(`     Organization ID:          ${CIRCLECI.organizationId}`)
  log(`     Project ID:               ${CIRCLECI.projectId}`)
  log(`     Pipeline Definition ID:   ${CIRCLECI.pipelineDefinitionId}`)
  log(`     Context IDs:              ${CIRCLECI.contextIds}`)
  log(`     VCS Origin:               ${CIRCLECI.vcsOrigin}`)
  log('')
  log('   Package access pages:')
  for (const pkg of packages) {
    log(`     → https://www.npmjs.com/package/${pkg}/access`)
  }
  log(`\n   Full setup guide: ${OIDC_SETUP_GUIDE}`)
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
