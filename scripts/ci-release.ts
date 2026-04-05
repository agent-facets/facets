/**
 * CI release script — replicates changesets/action@v1 behavior.
 *
 * Three paths:
 * 1. Pending changesets → run `changeset version`, create/update a "Version Packages" PR
 * 2. No pending changesets, all versions published → nothing to do, exit 0
 * 3. No pending changesets, unpublished versions → build, mint OIDC token, publish, push tags
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
    await io.ghPrCreate('main', RELEASE_BRANCH, PR_TITLE, prBody)
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
  await io.gitPushTags('origin', 'main')

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

  io.log('Published successfully.')
  return 0
}

export async function main(): Promise<number> {
  const files = await io.scanDir('.changeset')
  const pending = filterPendingChangesets(files)

  // Path 1: Pending changesets → version + PR
  if (!shouldPublish(pending)) {
    io.log(`Found ${pending.length} pending changeset(s).`)
    return versionAndCreatePR()
  }

  // Path 2 or 3: Check npm for unpublished versions
  const packages = await io.loadWorkspacePackages()
  const unpublished = await hasUnpublishedVersions(packages, io.npmViewVersion)

  if (!unpublished) {
    io.log('All package versions already published. Nothing to do.')
    return 0
  }

  // Path 3: Unpublished versions → build + publish
  return publish()
}

if (import.meta.main) {
  const code = await main().catch((err) => {
    io.error(err.message)
    return 1
  })
  process.exit(code)
}
