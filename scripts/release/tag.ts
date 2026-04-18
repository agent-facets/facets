/**
 * CI tag-release script — create version tags after a version PR merges,
 * then explicitly trigger the CircleCI release pipeline for each new tag.
 *
 * Runs on the `main` branch. Checks whether the current commit is a
 * merged version PR (by querying the GitHub API for associated PRs
 * with head ref `changeset-release/main`). If so, fetches the original
 * PR branch commit, creates annotated version tags on that commit for
 * any unpublished packages, and pushes the tags.
 *
 * After pushing, explicitly fires a CircleCI pipeline per tag via the
 * API v2 `pipeline/run` endpoint. We do this because GitHub-to-CircleCI
 * tag-push webhooks have proven unreliable when this bot pushes tags
 * (the CircleCI GitHub App appears to drop events from other bot actors).
 * The tag push itself remains useful for GitHub Releases, `git describe`,
 * and human history browsing — we just don't trust it to trigger CI.
 *
 * Invoked by the `main-pipeline` CircleCI job on the `main` branch.
 */

import { hasUnpublishedVersions } from '../lib/changesets'
import { loadWorkspacePackages, mintGithubTokens } from '../lib/ci'
import {
  CHANGESET_RELEASE_BRANCH,
  CIRCLECI_PROJECT_SLUG,
  CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID,
  GIT_BOT,
} from '../lib/constants'
import { io } from '../lib/io'

export async function tagRelease(): Promise<number> {
  const sha = process.env.CIRCLE_SHA1
  if (!sha) {
    io.console.error('CIRCLE_SHA1 not set. Not running in CI?')
    return 1
  }

  await mintGithubTokens()
  await io.gh.authSetupGit()

  const prs = await io.gh.getPrForCommit(sha)
  const versionPr = prs.find((p) => p.headRefName === CHANGESET_RELEASE_BRANCH)

  if (!versionPr) {
    io.console.log('Current commit is not a version PR merge. Nothing to do.')
    return 0
  }

  const headSha = versionPr.headRefOid
  io.console.log(`Version PR #${versionPr.number} detected. Original branch commit: ${headSha}`)

  await io.git.fetchSha('origin', headSha)

  const packages = await loadWorkspacePackages()
  const unpublished = await hasUnpublishedVersions(packages, io.npm.viewVersion)

  if (!unpublished) {
    io.console.log('All package versions already published. No tags needed.')
    return 0
  }

  await io.git.config('user.name', GIT_BOT.name)
  await io.git.config('user.email', GIT_BOT.email)

  const pushedTags: string[] = []
  for (const pkg of packages) {
    const npmVersion = await io.npm.viewVersion(pkg.name)
    if (npmVersion !== pkg.version) {
      const tag = `${pkg.name}@${pkg.version}`
      io.console.log(`Tagging: ${tag} -> ${headSha}`)
      await io.git.tagAt(tag, headSha)
      pushedTags.push(tag)
    }
  }

  await io.git.pushAllTags('origin')
  io.console.log('Tags pushed successfully.')

  // Explicitly trigger the release pipeline for each tag. See module docblock
  // for why we don't rely on GitHub-to-CircleCI webhooks for this.
  for (const tag of pushedTags) {
    io.console.log(`Triggering CircleCI release pipeline for ${tag}`)
    const result = await io.circleci.triggerPipelineForTag(
      CIRCLECI_PROJECT_SLUG,
      CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID,
      tag,
    )
    io.console.log(`  → pipeline #${result.number} (${result.id})`)
  }

  return 0
}

if (import.meta.main) {
  const code = await tagRelease()
  process.exit(code)
}
