/**
 * CI release script — publish a library package from a version tag.
 *
 * Triggered by a tag push matching a scoped version tag pattern
 * (e.g., `@agent-facets/core@0.3.0`). Parses the package name and
 * version from the tag, finds the package in the workspace, builds
 * via turbo, publishes to npm, creates a GitHub Release, and sends
 * a notification.
 *
 * Private packages (e.g., internal platform adapters) are skipped —
 * their tags may be created by the tagging step but they should not
 * be published to npm.
 *
 * CLI releases (`agent-facets@*`) are handled by the separate
 * release-cli workflow (build → matrix publish → finalize).
 *
 * Invoked by the `release` CircleCI workflow on tag push.
 */

import { announceRelease } from '../lib/announce'
import { loadWorkspacePackages, mintGithubTokens } from '../lib/ci'
import { io } from '../lib/io'
import { mintNpmToken } from '../lib/npm'
import { parseTag } from '../lib/tags'

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

  // Skip private packages — they are not published to npm.
  // Private packages may still get tags (e.g., the CLI package for triggering
  // the binary release pipeline, or internal adapter packages that participate
  // in changeset versioning). This guard prevents accidental npm publish attempts.
  if (pkg.private) {
    io.log(`Skipping release for private package ${parsed.name}@${parsed.version}`)
    return 0
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
