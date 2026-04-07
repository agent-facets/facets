#!/usr/bin/env bun

/**
 * Promote CLI platform packages from staging to latest.
 *
 * Flips the `latest` dist-tag for all 12 platform packages and the
 * main package using keyless OIDC token exchange. Idempotent — skips
 * packages where `latest` already points to the target version.
 *
 * Requires NPM_ID_TOKEN env var (set by ci-release.ts from CircleCI OIDC).
 *
 * Usage: bun scripts/promote-cli.ts <version>
 */

import { addDistTagViaApi, exchangeOidcToken, latestVersion } from './lib/npm'
import { allPackageNames } from './lib/target'

export async function promote(version: string): Promise<number> {
  const oidcJwt = process.env.NPM_ID_TOKEN
  if (!oidcJwt) {
    console.error('NPM_ID_TOKEN not set — cannot promote without OIDC credentials.')
    return 1
  }

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
      const npmToken = await exchangeOidcToken(pkg, oidcJwt)
      await addDistTagViaApi(pkg, version, 'latest', npmToken)
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
