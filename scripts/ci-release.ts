/**
 * CI release script — publish a single package from a version tag.
 *
 * Triggered by a tag push matching a version tag pattern (e.g.,
 * `@agent-facets/core@0.3.0`). Parses the package name and version
 * from the tag, finds the package in the workspace, builds, publishes
 * to npm, creates a GitHub Release, and notifies Slack.
 *
 * Private packages are skipped entirely — binary publishing is handled
 * separately (see scripts/publish-cli.ts).
 *
 * Invoked by the `release` CircleCI workflow on tag push.
 */

import { getChangelogEntry } from '@changesets/release-utils'
import { transformChangelogContent } from './lib/changesets'
import { io } from './lib/ci-io'
import { SLACK_CHANNELS } from './lib/constants'

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

  const packages = await io.loadWorkspacePackages()
  const pkg = packages.find((p) => p.name === parsed.name)
  if (!pkg) {
    io.error(`Package "${parsed.name}" not found in workspace`)
    return 1
  }

  if (pkg.version !== parsed.version) {
    io.error(`Version mismatch: tag says ${parsed.version}, package.json says ${pkg.version}`)
    return 1
  }

  // TODO(binary-matrix): Private packages (e.g., agent-facets CLI) need a per-platform
  // binary build + publish flow. See scripts/publish-cli.ts and scripts/build-cli.ts
  // for the half-implemented version. Once that's done, uncomment the GitHub Release
  // and Slack notification code below.
  if (pkg.private) {
    io.log(`Skipping release for private package: ${parsed.name}. Binary publishing not yet implemented.`)
    // Uncomment once binary publishing is implemented:
    // const ghToken = await io.mintGitHubToken()
    // process.env.GH_TOKEN = ghToken
    // const changelog = await io.readFile(`${pkg.dir}/CHANGELOG.md`)
    // const entry = getChangelogEntry(changelog, parsed.version)
    // const url = (await io.ghReleaseCreate(tag, tag, transformChangelogContent(entry.content))).trim()
    // io.log(`Created GitHub Release: ${url}`)
    // await io.slackNotify(SLACK_CHANNELS.auto_cli_deploys, `🚀 Published: <${url}|${tag}>`)
    return 0
  }

  const ghToken = await io.mintGitHubToken()
  process.env.GH_TOKEN = ghToken
  process.env.GITHUB_TOKEN = ghToken

  await io.turboBuild()

  const oidcToken = (await io.mintOidcToken()).trim()
  process.env.NPM_ID_TOKEN = oidcToken

  await io.npmPublish(pkg.dir)
  io.log(`Published ${parsed.name}@${parsed.version} to npm`)

  try {
    const changelog = await io.readFile(`${pkg.dir}/CHANGELOG.md`)
    const entry = getChangelogEntry(changelog, parsed.version)
    const url = (await io.ghReleaseCreate(tag, tag, transformChangelogContent(entry.content))).trim()
    io.log(`Created GitHub Release: ${url}`)

    try {
      await io.slackNotify(SLACK_CHANNELS.auto_cli_deploys, `🚀 Published: <${url}|${tag}>`)
    } catch (err) {
      io.error(`Failed to send Slack notification: ${(err as Error).message}`)
    }
  } catch (err) {
    io.error(`Failed to create GitHub Release for ${tag}: ${(err as Error).message}`)
  }

  io.log('Done.')
  return 0
}

if (import.meta.main) {
  await release()
}
