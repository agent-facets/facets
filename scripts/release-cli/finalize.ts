#!/usr/bin/env bun

/**
 * Finalize a CLI release — publish cli package, verify, announce.
 *
 * Runs after all 12 platform packages have been published to latest
 * by the matrix publish jobs. This script:
 *
 * 1. Mints a GitHub App token (for GitHub Release creation)
 * 2. Publishes the cli package (agent-facets) directly to latest
 * 3. Verifies all 13 packages are visible on npm
 * 4. Creates a GitHub Release and sends a notification
 *
 * Safety: the cli package is always the last package published. Users
 * cannot install the new version until this script succeeds, because
 * the cli package's optionalDependencies drive platform binary resolution.
 *
 * Invoked by the `finalize-cli` job in the release-cli CircleCI workflow.
 */

import { announceRelease } from '../lib/announce'
import { loadWorkspacePackages, mintGithubTokens } from '../lib/ci'
import { io } from '../lib/io'
import { parseTag } from '../lib/tags'

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

  // Mint GitHub token (for Release creation; npm OIDC is handled by the publish script)
  await mintGithubTokens()

  // Publish CLI package to latest (synthesizes from build output, mints its own OIDC token)
  io.log('Publishing CLI package...')
  await io.publishCliPackage()

  // Verify all packages are visible on npm
  io.log('Verifying packages in registry...')
  await io.verifyCli(parsed.version)

  io.log(`Published ${parsed.name}@${parsed.version} (all platform packages)`)

  // Announce
  const packages = await loadWorkspacePackages()
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
