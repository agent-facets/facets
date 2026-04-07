/**
 * CI release script — publish a single package from a version tag.
 *
 * Triggered by a tag push matching a version tag pattern (e.g.,
 * `@agent-facets/core@0.3.0` or `agent-facets@1.0.0`). Parses the
 * package name and version from the tag, finds the package in the
 * workspace, and runs the appropriate release pipeline:
 *
 * - **CLI wrapper (`agent-facets`)**: cross-compile 12 platform binaries,
 *   publish all packages to staging, verify registry propagation, promote
 *   to latest, create GitHub Release, and notify Slack.
 * - **Library packages**: build, publish to npm, create GitHub Release,
 *   and notify Slack.
 *
 * Invoked by the `release` CircleCI workflow on tag push.
 */

import { getChangelogEntry } from '@changesets/release-utils'
import { CLI_WRAPPER_NAME } from './lib/build-cli'
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

/** Create a GitHub Release and send a Slack notification. Non-fatal — failures are logged but don't fail the release. */
async function announceRelease(tag: string, dir: string, version: string): Promise<void> {
  try {
    const changelog = await io.readFile(`${dir}/CHANGELOG.md`)
    const entry = getChangelogEntry(changelog, version)
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

  // Shared setup — GitHub token and OIDC token for npm trusted publishing
  const ghToken = await io.mintGitHubToken()
  process.env.GH_TOKEN = ghToken
  process.env.GITHUB_TOKEN = ghToken

  const oidcToken = (await io.mintOidcToken()).trim()
  process.env.NPM_ID_TOKEN = oidcToken

  // CLI wrapper — cross-compile platform binaries and publish via staged pipeline
  if (parsed.name === CLI_WRAPPER_NAME) {
    io.log('Building CLI platform binaries...')
    await io.buildCli()

    io.log('Publishing CLI packages to staging...')
    await io.publishCli()

    io.log('Verifying CLI packages in registry...')
    await io.verifyCli(parsed.version)

    io.log('Promoting CLI packages to latest...')
    await io.promoteCli(parsed.version)

    io.log(`Published ${parsed.name}@${parsed.version} (all platform packages)`)
  } else {
    // Library packages — build and publish directly
    await io.turboBuild()
    await io.npmPublish(pkg.dir)
    io.log(`Published ${parsed.name}@${parsed.version} to npm`)
  }

  await announceRelease(tag, pkg.dir, parsed.version)

  io.log('Done.')
  return 0
}

if (import.meta.main) {
  await release()
}
