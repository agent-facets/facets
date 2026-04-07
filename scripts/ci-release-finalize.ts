#!/usr/bin/env bun

/**
 * Finalize a CLI release — publish main package, verify, promote, announce.
 *
 * Runs after all 12 platform packages have been published to staging
 * by the matrix publish jobs. This script:
 *
 * 1. Mints GitHub App + OIDC tokens
 * 2. Publishes the main package (agent-facets) to staging
 * 3. Verifies all 13 packages are visible on npm
 * 4. Promotes all 13 packages from staging to latest
 * 5. Creates a GitHub Release and sends a notification
 *
 * Invoked by the `finalize-cli` job in the release-cli CircleCI workflow.
 */

import { parseTag } from './ci-release'
import { announceRelease } from './lib/announce'
import { io, mintCiTokens } from './lib/ci-io'

export async function finalize(): Promise<number> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) {
    io.error('CIRCLE_TAG not set.')
    return 1
  }

  const parsed = parseTag(tag)
  if (!parsed) {
    io.error(`Could not parse tag: ${tag}`)
    return 1
  }

  io.log(`Finalizing release for ${parsed.name}@${parsed.version}`)

  // Mint tokens
  await mintCiTokens({ npm: true })

  // Publish main package to staging (synthesizes from build output)
  io.log('Publishing main package to staging...')
  await io.publishMainPackage()

  // Verify all packages are visible on npm
  io.log('Verifying packages in registry...')
  await io.verifyCli(parsed.version)

  // Promote all packages from staging to latest
  io.log('Promoting packages to latest...')
  await io.promoteCli(parsed.version)

  io.log(`Published ${parsed.name}@${parsed.version} (all platform packages)`)

  // Announce
  const packages = await io.loadWorkspacePackages()
  const pkg = packages.find((p) => p.name === parsed.name)
  if (pkg) {
    await announceRelease(tag, pkg.dir, parsed.version)
  }

  io.log('Done.')
  return 0
}

if (import.meta.main) {
  const code = await finalize()
  process.exit(code)
}
