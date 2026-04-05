/**
 * CI changesets script — version packages and create/update a release PR.
 *
 * Scans .changeset/ for pending changesets. If found, runs `changeset version`,
 * builds a rich PR body, and creates/updates a "Version Packages" PR targeting
 * the `release` branch.
 *
 * Invoked by the `changesets` CircleCI job on the `main` branch.
 */

import { buildVersionPrBody, filterPendingChangesets, replaceChangelogEntry, shouldPublish } from './lib/changesets'
import { io } from './lib/ci-io'
import { CHANGESET_COMMIT_MESSAGE, CHANGESET_PR_TITLE, CHANGESET_RELEASE_BRANCH, GIT_BOT } from './lib/constants'

export async function buildChangesets(): Promise<number> {
  const files = await io.scanDir('.changeset')
  const pending = filterPendingChangesets(files)

  if (shouldPublish(pending)) {
    io.log('No pending changesets. Nothing to do.')
    return 0
  }

  io.log(`Found ${pending.length} pending changeset(s). Creating version PR...`)

  const ghToken = await io.mintGitHubToken()
  process.env.GH_TOKEN = ghToken
  process.env.GITHUB_TOKEN = ghToken

  const packagesBefore = await io.loadWorkspacePackages()
  const versionsBefore = new Map(packagesBefore.map((p) => [p.name, p.version]))

  await io.changesetVersion()
  await io.bunInstall()

  const diff = await io.gitDiff()
  const diffCached = await io.gitDiffCached()
  if (diff.exitCode === 0 && diffCached.exitCode === 0) {
    io.log('No changes after versioning, nothing to do.')
    return 0
  }

  const packagesAfter = await io.loadWorkspacePackages()
  const changedPackages = packagesAfter.filter((p) => versionsBefore.get(p.name) !== p.version)
  const { body: prBody, entries } = await buildVersionPrBody(changedPackages, io.readFile)

  for (const entry of entries) {
    const changelogPath = `${entry.dir}/CHANGELOG.md`
    const original = await io.readFile(changelogPath)
    const rewritten = replaceChangelogEntry(original, entry.version, entry.content)
    await io.writeFile(changelogPath, rewritten)
  }

  await io.gitConfig('user.name', GIT_BOT.name)
  await io.gitConfig('user.email', GIT_BOT.email)
  await io.gitCheckout(CHANGESET_RELEASE_BRANCH)
  await io.gitAdd()
  await io.gitCommit(CHANGESET_COMMIT_MESSAGE)
  await io.gitPush('origin', CHANGESET_RELEASE_BRANCH, true)

  const prNumber = (await io.ghPrList(CHANGESET_RELEASE_BRANCH)).trim()
  if (prNumber) {
    await io.ghPrUpdate(prNumber, CHANGESET_PR_TITLE, prBody)
    io.log(`Updated existing PR #${prNumber}`)
  } else {
    await io.ghPrCreate('release', CHANGESET_RELEASE_BRANCH, CHANGESET_PR_TITLE, prBody)
    io.log('Created new Version Packages PR.')
  }

  return 0
}

if (import.meta.main) {
  const code = await buildChangesets().catch((err) => {
    io.error(err.message)
    return 1
  })
  process.exit(code)
}
