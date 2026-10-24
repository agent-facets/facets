#!/usr/bin/env bun

/** Dispatch and await the GitHub Actions workflow that owns CLI archive delivery. */
import { mintGithubTokens } from '../lib/ci'
import { io } from '../lib/io'

const WORKFLOW = 'release-cli-assets.yml'
const MAX_LOOKUPS = 60
const LOOKUP_DELAY_MS = 5_000

export type DispatchAttestedReleaseResult =
  | { ok: true; tag: string; runId: string }
  | { ok: false; code: 'missing-tag' }
  | { ok: false; code: 'github-auth-failed' }
  | { ok: false; code: 'workflow-dispatch-failed'; tag: string }
  | { ok: false; code: 'workflow-run-not-found'; tag: string }
  | { ok: false; code: 'workflow-run-failed'; tag: string; runId: string }

export async function dispatchAttestedRelease(): Promise<DispatchAttestedReleaseResult> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) return { ok: false, code: 'missing-tag' }

  try {
    await mintGithubTokens()
  } catch {
    return { ok: false, code: 'github-auth-failed' }
  }

  const dispatch = await io.gh.workflowDispatch(WORKFLOW, tag, tag)
  if (dispatch.exitCode !== 0) return { ok: false, code: 'workflow-dispatch-failed', tag }

  for (let attempt = 0; attempt < MAX_LOOKUPS; attempt++) {
    const listed = await io.gh.workflowLatestDispatchRun(WORKFLOW, tag)
    const runId = listed.exitCode === 0 ? listed.stdout.toString().trim() : ''
    if (runId && runId !== 'null') {
      const watched = await io.gh.workflowWatch(runId)
      return watched.exitCode === 0 ? { ok: true, tag, runId } : { ok: false, code: 'workflow-run-failed', tag, runId }
    }
    await Bun.sleep(LOOKUP_DELAY_MS)
  }

  return { ok: false, code: 'workflow-run-not-found', tag }
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
    case 'workflow-run-not-found':
      io.console.error(`GitHub Actions did not create a ${WORKFLOW} run for ${result.tag} before the timeout.`)
      break
    case 'workflow-run-failed':
      io.console.error(`GitHub Actions run ${result.runId} failed while delivering attested assets for ${result.tag}.`)
      break
  }
  return 1
}

if (import.meta.main) process.exit(renderDispatchAttestedReleaseResult(await dispatchAttestedRelease()))
