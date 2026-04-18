/**
 * CI changesets script — version packages and create/update a release PR.
 *
 * Scans .changeset/ for pending changesets. If found, runs `changeset version`,
 * builds a rich PR body, and creates/updates a "Version Packages" PR targeting
 * the `main` branch.
 *
 * Invoked by the `main-pipeline` CircleCI job on the `main` branch.
 */

import { buildVersionPrBody, filterPendingChangesets, replaceChangelogEntry, shouldPublish } from '../lib/changesets'
import { loadWorkspacePackages, mintGithubTokens } from '../lib/ci'
import { CHANGESET_COMMIT_MESSAGE, CHANGESET_PR_TITLE, CHANGESET_RELEASE_BRANCH, GIT_BOT } from '../lib/constants'
import { io } from '../lib/io'

export async function buildChangesets(): Promise<number> {
  const files = await io.shell.scanDir('.changeset')
  const pending = filterPendingChangesets(files)

  if (shouldPublish(pending)) {
    io.console.log('No pending changesets. Nothing to do.')
    return 0
  }

  io.console.log(`Found ${pending.length} pending changeset(s). Creating version PR...`)

  await mintGithubTokens()
  await io.gh.authSetupGit()

  const packagesBefore = await loadWorkspacePackages()
  const versionsBefore = new Map(packagesBefore.map((p) => [p.name, p.version]))

  await io.shell.changesetVersion()
  await io.shell.bunInstall()

  const diff = await io.git.diff()
  const diffCached = await io.git.diffCached()
  if (diff.exitCode === 0 && diffCached.exitCode === 0) {
    io.console.log('No changes after versioning, nothing to do.')
    return 0
  }

  const packagesAfter = await loadWorkspacePackages()
  const changedPackages = packagesAfter.filter((p) => versionsBefore.get(p.name) !== p.version)
  const { body: prBody, entries } = await buildVersionPrBody(changedPackages, io.shell.readFile)

  for (const entry of entries) {
    const changelogPath = `${entry.dir}/CHANGELOG.md`
    const original = await io.shell.readFile(changelogPath)
    const rewritten = replaceChangelogEntry(original, entry.version, entry.content)
    await io.shell.writeFile(changelogPath, rewritten)
  }

  await io.git.config('user.name', GIT_BOT.name)
  await io.git.config('user.email', GIT_BOT.email)
  await io.git.checkout(CHANGESET_RELEASE_BRANCH)
  await io.git.add()
  await io.git.commit(CHANGESET_COMMIT_MESSAGE)
  await io.git.push('origin', CHANGESET_RELEASE_BRANCH, true)

  const prNumber = (await io.gh.prList(CHANGESET_RELEASE_BRANCH)).trim()
  if (prNumber) {
    await io.gh.prUpdate(prNumber, CHANGESET_PR_TITLE, prBody)
    io.console.log(`Updated existing PR #${prNumber}`)
  } else {
    await io.gh.prCreate('main', CHANGESET_RELEASE_BRANCH, CHANGESET_PR_TITLE, prBody)
    io.console.log('Created new Version Packages PR.')
  }

  return 0
}

if (import.meta.main) {
  const code = await buildChangesets()
  process.exit(code)
}
