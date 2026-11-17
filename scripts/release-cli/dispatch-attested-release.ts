#!/usr/bin/env bun

import { slackNotify } from '../lib/announce'
/** Dispatch and await the GitHub Actions workflow that owns CLI archive delivery. */
import { mintGithubTokens } from '../lib/ci'
import { GITHUB_REPO, SLACK_CHANNELS } from '../lib/constants'
import { io } from '../lib/io'

const WORKFLOW = 'release-cli-assets.yml'
export type DispatchAttestedReleaseResult =
  | { ok: true; tag: string; runId: string }
  | { ok: false; code: 'missing-tag' }
  | { ok: false; code: 'github-auth-failed' }
  | { ok: false; code: 'workflow-inspect-failed'; tag: string }
  | { ok: false; code: 'workflow-dispatch-failed'; tag: string }
  | { ok: false; code: 'workflow-dispatch-response-invalid'; tag: string }
  | { ok: false; code: 'workflow-run-failed'; tag: string; runId: string }

export interface DispatchAttestedReleaseOptions {
  /** Best-effort post-publication notification, injected by tests. */
  notify?: (tag: string) => Promise<void>
}

export async function notifyAttestedRelease(tag: string): Promise<void> {
  try {
    await slackNotify(
      SLACK_CHANNELS.auto_cli_deploys,
      `🚀 Published: <https://github.com/${GITHUB_REPO}/releases/tag/${encodeURIComponent(tag)}|${tag}>`,
    )
  } catch {
    io.console.error(`GitHub Release ${tag} was published, but Slack notification failed.`)
  }
}

function parseDispatchedRunId(stdout: Buffer): string | undefined {
  try {
    const response = JSON.parse(stdout.toString()) as { workflow_run_id?: unknown }
    return typeof response.workflow_run_id === 'number' && Number.isSafeInteger(response.workflow_run_id)
      ? String(response.workflow_run_id)
      : undefined
  } catch {
    return undefined
  }
}

type WorkflowRun = { databaseId: number; headSha: string; status: string; conclusion: string }

function reusableRun(stdout: Buffer, sha: string): { ok: true; runId?: string } | { ok: false } {
  try {
    const runs: unknown = JSON.parse(stdout.toString())
    if (
      !Array.isArray(runs) ||
      !runs.every(
        (run) =>
          run &&
          Number.isSafeInteger(run.databaseId) &&
          run.databaseId > 0 &&
          typeof run.headSha === 'string' &&
          typeof run.status === 'string' &&
          typeof run.conclusion === 'string',
      )
    ) {
      return { ok: false }
    }
    const matching = (runs as WorkflowRun[]).filter((run) => run.headSha === sha)
    // A later failed duplicate must not hide an already successful delivery.
    const run =
      matching.find((run) => run.status === 'completed' && run.conclusion === 'success') ??
      matching.find((run) => run.status !== 'completed')
    return { ok: true, runId: run ? String(run.databaseId) : undefined }
  } catch {
    return { ok: false }
  }
}

async function watchWithRetry(runId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const watched = await io.gh.workflowWatch(runId)
    if (watched.exitCode === 0) return true
    const diagnostic = watched.stderr.toString()
    // Retry transport/visibility failures, never a completed workflow failure.
    if (
      !/HTTP (?:404|429|5\d\d)\b|TLS handshake timeout|i\/o timeout|connection reset|unexpected EOF/i.test(diagnostic)
    ) {
      return false
    }
    if (attempt === 4) return false
    io.console.log(`GitHub run ${runId} is temporarily unavailable; retrying watch (${attempt + 1}/4).`)
    await io.shell.sleep(2000 * 2 ** attempt)
  }
  return false
}

export async function dispatchAttestedRelease(
  options: DispatchAttestedReleaseOptions = {},
): Promise<DispatchAttestedReleaseResult> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) return { ok: false, code: 'missing-tag' }

  try {
    await mintGithubTokens()
  } catch {
    return { ok: false, code: 'github-auth-failed' }
  }

  const commit = await io.git.resolveCommit(tag)
  const sha = commit.stdout.toString().trim()
  if (commit.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(sha)) {
    return { ok: false, code: 'workflow-inspect-failed', tag }
  }
  const listed = await io.gh.workflowRuns(WORKFLOW, tag)
  if (listed.exitCode !== 0) return { ok: false, code: 'workflow-inspect-failed', tag }
  const reusable = reusableRun(listed.stdout, sha)
  if (!reusable.ok) return { ok: false, code: 'workflow-inspect-failed', tag }

  let runId = reusable.runId
  if (runId) {
    io.console.log(`Reusing GitHub Actions run ${runId} for ${tag} (${sha}).`)
  } else {
    const dispatch = await io.gh.workflowDispatch(WORKFLOW, tag, tag)
    if (dispatch.exitCode !== 0) return { ok: false, code: 'workflow-dispatch-failed', tag }
    runId = parseDispatchedRunId(dispatch.stdout)
    if (!runId) return { ok: false, code: 'workflow-dispatch-response-invalid', tag }
  }
  if (!(await watchWithRetry(runId))) return { ok: false, code: 'workflow-run-failed', tag, runId }
  await (options.notify ?? notifyAttestedRelease)(tag)
  return { ok: true, tag, runId }
}

export function renderDispatchAttestedReleaseResult(result: DispatchAttestedReleaseResult): number {
  if (result.ok) {
    io.console.log(`GitHub Actions completed attested archive delivery for ${result.tag} (run ${result.runId}).`)
    return 0
  }

  switch (result.code) {
    case 'missing-tag':
      io.console.error('CIRCLE_TAG not set.')
      break
    case 'github-auth-failed':
      io.console.error('Failed to authenticate with GitHub to dispatch attested CLI archive delivery.')
      break
    case 'workflow-inspect-failed':
      io.console.error(`Failed to inspect the tag commit or existing archive workflow runs for ${result.tag}.`)
      break
    case 'workflow-dispatch-failed':
      io.console.error(
        `Failed to dispatch ${WORKFLOW} for ${result.tag}. Confirm the GitHub App has the approved Actions workflow permission.`,
      )
      break
    case 'workflow-dispatch-response-invalid':
      io.console.error(`GitHub did not return a valid workflow run ID while dispatching ${WORKFLOW} for ${result.tag}.`)
      break
    case 'workflow-run-failed':
      io.console.error(`GitHub Actions run ${result.runId} failed while delivering attested assets for ${result.tag}.`)
      break
  }
  return 1
}

if (import.meta.main) process.exit(renderDispatchAttestedReleaseResult(await dispatchAttestedRelease()))
