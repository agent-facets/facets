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

/**
 * Poll parameters for GitHub's commit→PR index catching up after a squash merge.
 *
 * GitHub's `repos/{owner}/{repo}/commits/{sha}/pulls` endpoint is backed by a
 * search index that lags behind the merge event by ~60 seconds in observed
 * cases. If tag.ts runs before the index catches up, `getPrForCommit` returns
 * an empty array and we'd silently skip tagging — which broke the 0.5.3
 * release (pipeline 196).
 *
 * We poll at a fixed 10-second interval for up to 5 minutes. If the endpoint
 * still returns empty after the full window, we fall through to the existing
 * "nothing to do" exit path — a legitimate non-version-PR merge with no
 * associated PRs in the API.
 */
const PR_POLL_INTERVAL_MS = 10_000
const PR_POLL_MAX_ATTEMPTS = 30

/**
 * Match scoped package tags — `@agent-facets/<pkg>@<version>` — and capture
 * `<pkg>`. Unscoped tags (`agent-facets@<version>`, the CLI) do not match,
 * so the triggering code skips the `package` parameter for them. The
 * package name is forwarded as a pipeline parameter so the `release`
 * workflow's `serial-group` can queue per-package.
 */
const SCOPED_TAG_PACKAGE_REGEX = /^@agent-facets\/([a-z0-9-]+)@/

function extractPackageName(tag: string): string | undefined {
  const match = SCOPED_TAG_PACKAGE_REGEX.exec(tag)
  return match?.[1]
}

export async function tagRelease(): Promise<number> {
  const sha = process.env.CIRCLE_SHA1
  if (!sha) {
    io.console.error('CIRCLE_SHA1 not set. Not running in CI?')
    return 1
  }

  await mintGithubTokens()
  await io.gh.authSetupGit()

  let prs = await io.gh.getPrForCommit(sha)
  for (let attempt = 1; attempt < PR_POLL_MAX_ATTEMPTS && prs.length === 0; attempt++) {
    io.console.log(
      `PR not yet indexed for ${sha}, retrying in ${PR_POLL_INTERVAL_MS / 1000}s (attempt ${attempt + 1}/${PR_POLL_MAX_ATTEMPTS})...`,
    )
    await io.shell.sleep(PR_POLL_INTERVAL_MS)
    prs = await io.gh.getPrForCommit(sha)
  }

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
    // Workspace-only packages (e.g. @agent-facets/common) have no `version`
    // field in their package.json — they're bundled into consumers at build
    // time and never published to npm. Upstream, `.changeset/config.json`
    // `ignore` keeps them out of version-bump PRs entirely. This guard is
    // the defensive fallback: without it we'd try to tag `@pkg@undefined`.
    if (!pkg.version) continue
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
  //
  // For scoped package tags (`@agent-facets/<pkg>@<version>`), we forward
  // the package name as a pipeline parameter so the `release` workflow's
  // `serial-group` queues per-package. The CLI tag (`agent-facets@<version>`)
  // goes through `release-cli`, which doesn't use the parameter.
  for (const tag of pushedTags) {
    const packageName = extractPackageName(tag)
    io.console.log(`Triggering CircleCI release pipeline for ${tag}`)
    const result = await io.circleci.triggerPipelineForTag(
      CIRCLECI_PROJECT_SLUG,
      CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID,
      tag,
      packageName,
    )
    io.console.log(`  → pipeline #${result.number} (${result.id})`)
  }

  return 0
}

if (import.meta.main) {
  const code = await tagRelease()
  process.exit(code)
}
