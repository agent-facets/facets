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
import { mintNpmToken, packAndPublish, versionExists } from '../lib/npm'
import { parseTag } from '../lib/tags'

export async function release(): Promise<number> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) {
    io.console.error('CIRCLE_TAG not set. Not running on a tag push?')
    return 1
  }

  const parsed = parseTag(tag)
  if (!parsed) {
    io.console.error(`Could not parse package name and version from tag: ${tag}`)
    return 1
  }

  io.console.log(`Release triggered for ${parsed.name}@${parsed.version} (tag: ${tag})`)

  const packages = await loadWorkspacePackages()
  const pkg = packages.find((p) => p.name === parsed.name)
  if (!pkg) {
    io.console.error(`Package "${parsed.name}" not found in workspace`)
    return 1
  }

  if (pkg.version !== parsed.version) {
    io.console.error(`Version mismatch: tag says ${parsed.version}, package.json says ${pkg.version}`)
    return 1
  }

  // Skip private packages — they are not published to npm.
  // Private packages may still get tags (e.g., the CLI package for triggering
  // the binary release pipeline, or internal adapter packages that participate
  // in changeset versioning). This guard prevents accidental npm publish attempts.
  if (pkg.private) {
    io.console.log(`Skipping release for private package ${parsed.name}@${parsed.version}`)
    return 0
  }

  // Idempotency: skip npm publish if this version is already on the registry.
  // This lets us safely re-push a tag to re-trigger the pipeline (e.g., to
  // recover from a transient post-publish failure like a broken GitHub Release)
  // without npm rejecting the second publish with 409. The GitHub Release and
  // Slack notification steps below are already tolerant of re-runs —
  // announceRelease's `gh release create` is a no-op on existing releases and
  // slackNotify is best-effort.
  const alreadyPublished = await versionExists(parsed.name, parsed.version)
  if (alreadyPublished) {
    io.console.log(`~ ${parsed.name}@${parsed.version} already on npm, skipping publish`)
  }

  // Shared setup — GitHub token and OIDC token for npm trusted publishing
  await mintGithubTokens()

  // Library packages — build and publish directly
  if (!alreadyPublished) {
    await mintNpmToken()
    // Scope build to the released package + its workspace deps. The trailing
    // `...` is Turbo's "include dependencies" filter, so e.g. `engine` still
    // builds `protocol` first when an engine tag fires. Avoids the OOM that
    // killed releases when all 11 packages built in parallel — see
    // .circleci/development/commands/run-check.yml for the memory analysis.
    await io.shell.turboBuild(`${pkg.name}...`)
    await packAndPublish(pkg.dir)
    io.console.log(`Published ${parsed.name}@${parsed.version} to npm`)
  }

  await announceRelease(tag, pkg.dir, parsed.version)

  io.console.log('Done.')
  return 0
}

if (import.meta.main) {
  const code = await release()
  process.exit(code)
}
