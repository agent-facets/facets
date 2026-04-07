/**
 * CI release script — publish a library package from a version tag.
 *
 * Triggered by a tag push matching a scoped version tag pattern
 * (e.g., `@agent-facets/core@0.3.0`). Parses the package name and
 * version from the tag, finds the package in the workspace, builds
 * via turbo, publishes to npm, creates a GitHub Release, and sends
 * a notification.
 *
 * CLI releases (`agent-facets@*`) are handled by the separate
 * release-cli workflow (build-cli → matrix publish → finalize-cli).
 *
 * Invoked by the `release-library` CircleCI workflow on tag push.
 */

import { announceRelease } from './lib/announce'
import { loadWorkspacePackages, mintGithubTokens } from './lib/ci'
import { io } from './lib/io'
import { mintNpmToken } from './lib/npm'

/**
 * Parse a version tag into package name and version.
 * Handles both scoped (`@scope/name@1.0.0`) and unscoped (`name@1.0.0`) tags.
 */
export function parseTag(tag: string): { name: string; version: string } | null {
  const scoped = tag.match(/^(@[^@]+)@(\d+\..+)$/)
  if (scoped?.[1] && scoped[2]) return { name: scoped[1], version: scoped[2] }

  const unscoped = tag.match(/^([^@]+)@(\d+\..+)$/)
  if (unscoped?.[1] && unscoped[2]) return { name: unscoped[1], version: unscoped[2] }

  return null
}

export async function release(): Promise<number> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) {
    io.error('CIRCLE_TAG not set. Not running on a tag push?')
    return 1
  }

  const parsed = parseTag(tag)
  if (!parsed) {
    io.error(`Could not parse package name and version from tag: ${tag}`)
    return 1
  }

  io.log(`Release triggered for ${parsed.name}@${parsed.version} (tag: ${tag})`)

  const packages = await loadWorkspacePackages()
  const pkg = packages.find((p) => p.name === parsed.name)
  if (!pkg) {
    io.error(`Package "${parsed.name}" not found in workspace`)
    return 1
  }

  if (pkg.version !== parsed.version) {
    io.error(`Version mismatch: tag says ${parsed.version}, package.json says ${pkg.version}`)
    return 1
  }

  // Shared setup — GitHub token and OIDC token for npm trusted publishing
  await mintGithubTokens()
  await mintNpmToken()

  // Library packages — build and publish directly
  await io.turboBuild()
  await io.npmPublish(pkg.dir)
  io.log(`Published ${parsed.name}@${parsed.version} to npm`)

  await announceRelease(tag, pkg.dir, parsed.version)

  io.log('Done.')
  return 0
}

if (import.meta.main) {
  await release()
}
