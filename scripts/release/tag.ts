/**
 * CI tag-release script — create version tags after a version PR merges.
 *
 * Runs on the `main` branch. Checks whether the current commit is a
 * merged version PR (by querying the GitHub API for associated PRs
 * with head ref `changeset-release/main`). If so, fetches the original
 * PR branch commit, creates annotated version tags on that commit for
 * any unpublished packages, and pushes the tags.
 *
 * Invoked by the `main-pipeline` CircleCI job on the `main` branch.
 */

import { hasUnpublishedVersions } from '../lib/changesets'
import { loadWorkspacePackages, mintGithubTokens } from '../lib/ci'
import { CHANGESET_RELEASE_BRANCH, GIT_BOT } from '../lib/constants'
import { io } from '../lib/io'

export async function tagRelease(): Promise<number> {
  const sha = process.env.CIRCLE_SHA1
  if (!sha) {
    io.error('CIRCLE_SHA1 not set. Not running in CI?')
    return 1
  }

  await mintGithubTokens()
  await io.ghAuthSetupGit()

  const prs = await io.ghGetPrForCommit(sha)
  const versionPr = prs.find((p) => p.headRefName === CHANGESET_RELEASE_BRANCH)

  if (!versionPr) {
    io.log('Current commit is not a version PR merge. Nothing to do.')
    return 0
  }

  const headSha = versionPr.headRefOid
  io.log(`Version PR #${versionPr.number} detected. Original branch commit: ${headSha}`)

  await io.gitFetchSha('origin', headSha)

  const packages = await loadWorkspacePackages()
  const unpublished = await hasUnpublishedVersions(packages, io.npmViewVersion)

  if (!unpublished) {
    io.log('All package versions already published. No tags needed.')
    return 0
  }

  await io.gitConfig('user.name', GIT_BOT.name)
  await io.gitConfig('user.email', GIT_BOT.email)

  for (const pkg of packages) {
    const npmVersion = await io.npmViewVersion(pkg.name)
    if (npmVersion !== pkg.version) {
      const tag = `${pkg.name}@${pkg.version}`
      io.log(`Tagging: ${tag} -> ${headSha}`)
      await io.gitTagAt(tag, headSha)
    }
  }

  await io.gitPushAllTags('origin')
  io.log('Tags pushed successfully.')
  return 0
}

if (import.meta.main) {
  const code = await tagRelease()
  process.exit(code)
}
