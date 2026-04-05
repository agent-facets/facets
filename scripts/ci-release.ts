/**
 * CI release script — build, publish, and announce releases.
 *
 * Checks for unpublished package versions. If found, builds all packages,
 * mints an OIDC token for npm trusted publishing, publishes to npm,
 * creates GitHub Releases, notifies Slack, and syncs the release branch
 * back to main.
 *
 * Invoked by the `release` CircleCI job on the `release` branch.
 */

import { getChangelogEntry } from '@changesets/release-utils'
import {
  comparePackageOrder,
  hasUnpublishedVersions,
  parsePublishedPackages,
  transformChangelogContent,
} from './lib/changesets'
import { io } from './lib/ci-io'
import { ALL_SLACK_CHANNELS, SYNC_PR_BODY, SYNC_PR_TITLE } from './lib/constants'

export async function release(): Promise<number> {
  const packages = await io.loadWorkspacePackages()
  const unpublished = await hasUnpublishedVersions(packages, io.npmViewVersion)

  if (!unpublished) {
    io.log('All package versions already published. Nothing to do.')
    return 0
  }

  io.log('Unpublished versions found. Building and publishing...')

  const ghToken = await io.mintGitHubToken()
  process.env.GH_TOKEN = ghToken
  process.env.GITHUB_TOKEN = ghToken

  await io.turboBuild()

  const oidcToken = (await io.mintOidcToken()).trim()
  process.env.NPM_ID_TOKEN = oidcToken

  const publishOutput = await io.changesetPublish()
  await io.gitPushTags('origin', 'release')

  const allPackages = await io.loadWorkspacePackages()
  const packagesByName = new Map(allPackages.map((p) => [p.name, p]))
  const published = parsePublishedPackages(publishOutput)
  const releasedUrls: { tag: string; url: string }[] = []

  for (const pkg of published) {
    const tag = `${pkg.name}@${pkg.version}`
    const workspacePkg = packagesByName.get(pkg.name)

    try {
      if (!workspacePkg) {
        io.error(`Package "${pkg.name}" not found in workspace, skipping release for ${tag}`)
        continue
      }

      const changelog = await io.readFile(`${workspacePkg.dir}/CHANGELOG.md`)
      const entry = getChangelogEntry(changelog, pkg.version)
      const url = (await io.ghReleaseCreate(tag, tag, transformChangelogContent(entry.content))).trim()
      io.log(`Created GitHub Release: ${tag}`)
      releasedUrls.push({ tag, url })
    } catch (err) {
      io.error(`Failed to create release for ${tag}: ${(err as Error).message}`)
    }
  }

  if (releasedUrls.length > 0) {
    releasedUrls.sort((a, b) => {
      const nameA = a.tag.replace(/@[^@]+$/, '')
      const nameB = b.tag.replace(/@[^@]+$/, '')
      return comparePackageOrder(nameA, nameB)
    })
    const lines = releasedUrls.map((r) => `• <${r.url}|${r.tag}>`)
    const message = `🚀 Published ${releasedUrls.length} release(s):\n${lines.join('\n')}`
    try {
      await io.slackNotify(ALL_SLACK_CHANNELS, message)
    } catch (err) {
      io.error(`Failed to send Slack release notification: ${(err as Error).message}`)
    }
  }

  io.log('Syncing release branch back to main...')
  try {
    await io.gitFetch('origin', 'main')
    await io.gitCheckout('main')
    await io.gitMerge('release')
    await io.gitPush('origin', 'main', false)
    io.log('Successfully synced release to main.')
  } catch {
    io.log('Merge to main failed. Creating fallback PR...')
    try {
      const existingPr = (await io.ghPrListWithBase('release', 'main')).trim()
      if (!existingPr) {
        await io.ghPrCreate('main', 'release', SYNC_PR_TITLE, SYNC_PR_BODY)
      }
      const prUrl = (await io.ghPrUrl('release', 'main')).trim()
      await io.slackNotify(
        ALL_SLACK_CHANNELS,
        `⚠️ Release published successfully, but sync-back to main failed. PR created: ${prUrl}`,
      )
    } catch (notifyErr) {
      io.error(`Failed to create fallback PR or notify Slack: ${(notifyErr as Error).message}`)
    }
  }

  io.log('Published successfully.')
  return 0
}

if (import.meta.main) {
  const code = await release().catch((err) => {
    io.error(err.message)
    return 1
  })
  process.exit(code)
}
