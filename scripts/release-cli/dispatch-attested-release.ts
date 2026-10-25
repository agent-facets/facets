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

  const dispatch = await io.gh.workflowDispatch(WORKFLOW, tag, tag)
  if (dispatch.exitCode !== 0) return { ok: false, code: 'workflow-dispatch-failed', tag }
  const runId = parseDispatchedRunId(dispatch.stdout)
  if (!runId) return { ok: false, code: 'workflow-dispatch-response-invalid', tag }

  const watched = await io.gh.workflowWatch(runId)
  if (watched.exitCode !== 0) return { ok: false, code: 'workflow-run-failed', tag, runId }
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
