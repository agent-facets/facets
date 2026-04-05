/**
 * CI release script — branch-aware release pipeline.
 *
 * On `main` branch:
 *   Pending changesets → run `changeset version`, create/update a "Version Packages" PR targeting `release`
 *   No pending changesets → nothing to do, exit 0
 *
 * On `release` branch:
 *   Unpublished versions → build, mint OIDC token, publish, push tags, sync back to main
 *   All versions published → nothing to do, exit 0
 *
 * On any other branch: exit 0 (no-op)
 *
 * Uses the IO adapter (lib/ci-io.ts) for all side effects so the
 * orchestration logic is fully testable.
 */

import { getChangelogEntry } from '@changesets/release-utils'
import {
  buildVersionPrBody,
  filterPendingChangesets,
  hasUnpublishedVersions,
  parsePublishedPackages,
  replaceChangelogEntry,
  shouldPublish,
  transformChangelogContent,
} from './lib/changesets'
import { io } from './lib/ci-io'

const RELEASE_BRANCH = 'changeset-release/main'
const PR_TITLE = 'Version Packages'
const SLACK_CHANNELS = 'C0AQVA6UB38,C0AQFU5S4PR'

export async function versionAndCreatePR(): Promise<number> {
  io.log('Pending changesets found. Creating version PR...')

  // Mint a GitHub App token for gh CLI (PR creation) and git push
  const ghToken = await io.mintGitHubToken()
  process.env.GH_TOKEN = ghToken
  process.env.GITHUB_TOKEN = ghToken

  // Snapshot package versions before changeset version
  const packagesBefore = await io.loadWorkspacePackages()
  const versionsBefore = new Map(packagesBefore.map((p) => [p.name, p.version]))

  await io.changesetVersion()
  await io.bunInstall()

  // Check for actual changes after versioning
  const diff = await io.gitDiff()
  const diffCached = await io.gitDiffCached()
  if (diff.exitCode === 0 && diffCached.exitCode === 0) {
    io.log('No changes after versioning, nothing to do.')
    return 0
  }

  // Detect which packages changed and build rich PR body
  const packagesAfter = await io.loadWorkspacePackages()
  const changedPackages = packagesAfter.filter((p) => versionsBefore.get(p.name) !== p.version)
  const { body: prBody, entries } = await buildVersionPrBody(changedPackages, io.readFile)

  // Rewrite CHANGELOG.md files with transformed content
  for (const entry of entries) {
    const changelogPath = `${entry.dir}/CHANGELOG.md`
    const original = await io.readFile(changelogPath)
    const rewritten = replaceChangelogEntry(original, entry.version, entry.content)
    await io.writeFile(changelogPath, rewritten)
  }

  // Configure git identity
  await io.gitConfig('user.name', 'circleci[bot]')
  await io.gitConfig('user.email', 'circleci[bot]@users.noreply.github.com')

  // Create/update branch and push
  await io.gitCheckout(RELEASE_BRANCH)
  await io.gitAdd()
  await io.gitCommit('ci(release): version packages')
  await io.gitPush('origin', RELEASE_BRANCH, true)

  // Create or update PR with rich body
  const prNumber = (await io.ghPrList(RELEASE_BRANCH)).trim()
  if (prNumber) {
    await io.ghPrUpdate(prNumber, PR_TITLE, prBody)
    io.log(`Updated existing PR #${prNumber}`)
  } else {
    await io.ghPrCreate('release', RELEASE_BRANCH, PR_TITLE, prBody)
    io.log('Created new Version Packages PR.')
  }

  return 0
}

export async function publish(): Promise<number> {
  io.log('Unpublished versions found. Building and publishing...')

  // Mint GitHub App token for creating releases
  const ghToken = await io.mintGitHubToken()
  process.env.GH_TOKEN = ghToken
  process.env.GITHUB_TOKEN = ghToken

  await io.turboBuild()

  // Mint OIDC token for npm trusted publishing
  const oidcToken = (await io.mintOidcToken()).trim()
  process.env.NPM_ID_TOKEN = oidcToken

  // Publish to npm and capture stdout for parsing released packages
  const publishOutput = await io.changesetPublish()
  await io.gitPushTags('origin', 'release')

  // Create GitHub Releases for each published package
  const packages = await io.loadWorkspacePackages()
  const packagesByName = new Map(packages.map((p) => [p.name, p]))
  const published = parsePublishedPackages(publishOutput)

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
      await io.ghReleaseCreate(tag, tag, transformChangelogContent(entry.content))
      io.log(`Created GitHub Release: ${tag}`)
    } catch (err) {
      io.error(`Failed to create release for ${tag}: ${(err as Error).message}`)
    }
  }

  // Sync release branch back to main
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
        await io.ghPrCreate(
          'main',
          'release',
          'Sync Release to Main',
          'Automatic sync-back from release branch after publishing. Please resolve any conflicts and merge.',
        )
      }
      const prUrl = (await io.ghPrUrl('release', 'main')).trim()
      await io.slackNotify(
        SLACK_CHANNELS,
        `⚠️ Release published successfully, but sync-back to main failed. PR created: ${prUrl}`,
      )
    } catch (notifyErr) {
      io.error(`Failed to create fallback PR or notify Slack: ${(notifyErr as Error).message}`)
    }
  }

  io.log('Published successfully.')
  return 0
}

export async function main(): Promise<number> {
  const currentBranch = process.env.CIRCLE_BRANCH ?? ''

  // On main: only handle versioning (create PR targeting release)
  if (currentBranch === 'main') {
    const files = await io.scanDir('.changeset')
    const pending = filterPendingChangesets(files)

    if (!shouldPublish(pending)) {
      io.log(`Found ${pending.length} pending changeset(s).`)
      return versionAndCreatePR()
    }

    io.log('No pending changesets on main. Nothing to do.')
    return 0
  }

  // On release: only handle publishing
  if (currentBranch === 'release') {
    const packages = await io.loadWorkspacePackages()
    const unpublished = await hasUnpublishedVersions(packages, io.npmViewVersion)

    if (!unpublished) {
      io.log('All package versions already published. Nothing to do.')
      return 0
    }

    return publish()
  }

  io.log(`Branch "${currentBranch}" is not main or release. Nothing to do.`)
  return 0
}

if (import.meta.main) {
  const code = await main().catch((err) => {
    io.error(err.message)
    return 1
  })
  process.exit(code)
}
