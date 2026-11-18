import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from '../lib/io'
import { shellResult, silenceIO } from '../lib/test-helpers'
import { dispatchAttestedRelease } from './dispatch-attested-release'

const SHA = 'a'.repeat(40)
const run = (databaseId: number, status = 'completed', conclusion = 'success', headSha = SHA) => ({
  databaseId,
  headSha,
  status,
  conclusion,
})
const watchFailure = (stderr: string) => ({ ...shellResult('', 1), stderr: Buffer.from(stderr) })

describe('dispatch-attested-release.ts', () => {
  beforeEach(() => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    silenceIO()
    spyOn(io.shell, 'mintGitHubAppToken').mockResolvedValue('token')
    spyOn(io.git, 'resolveCommit').mockResolvedValue(shellResult(SHA))
    spyOn(io.gh, 'workflowRuns').mockResolvedValue(shellResult('[]'))
    spyOn(io.shell, 'sleep').mockResolvedValue()
  })

  afterEach(() => {
    mock.restore()
    delete process.env.CIRCLE_TAG
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
  })

  test('dispatches the tag and waits for the matching workflow run', async () => {
    const dispatch = spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('{"workflow_run_id":123}'))
    const watch = spyOn(io.gh, 'workflowWatch').mockResolvedValue(shellResult())

    const notify = mock(() => Promise.resolve())

    expect(await dispatchAttestedRelease({ notify })).toEqual({ ok: true, tag: 'agent-facets@0.4.0', runId: '123' })
    expect(dispatch).toHaveBeenCalledWith('release-cli-assets.yml', 'agent-facets@0.4.0', 'agent-facets@0.4.0')
    expect(watch).toHaveBeenCalledWith('123')
    expect(notify).toHaveBeenCalledWith('agent-facets@0.4.0')
  })

  test('reports a dispatch permission failure without watching a run', async () => {
    spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('', 1))
    const watch = spyOn(io.gh, 'workflowWatch')

    expect(await dispatchAttestedRelease()).toEqual({
      ok: false,
      code: 'workflow-dispatch-failed',
      tag: 'agent-facets@0.4.0',
    })
    expect(watch).not.toHaveBeenCalled()
  })

  test('does not notify when the watched workflow run fails', async () => {
    spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('{"workflow_run_id":123}'))
    const watch = spyOn(io.gh, 'workflowWatch').mockResolvedValue(watchFailure('workflow failed'))
    const notify = mock(() => Promise.resolve())

    expect(await dispatchAttestedRelease({ notify })).toEqual({
      ok: false,
      code: 'workflow-run-failed',
      tag: 'agent-facets@0.4.0',
      runId: '123',
    })
    expect(notify).not.toHaveBeenCalled()
    expect(watch).toHaveBeenCalledTimes(1)
    expect(io.shell.sleep).not.toHaveBeenCalled()
  })

  test.each([
    'HTTP 404: Not Found',
    'HTTP 429: Too Many Requests',
    'HTTP 503: Service Unavailable',
    'i/o timeout',
  ])('retries a transient watcher failure: %s', async (diagnostic) => {
    const dispatch = spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('{"workflow_run_id":123}'))
    const watch = spyOn(io.gh, 'workflowWatch')
      .mockResolvedValueOnce(watchFailure(diagnostic))
      .mockResolvedValueOnce(shellResult())
    expect(await dispatchAttestedRelease({ notify: async () => {} })).toEqual({
      ok: true,
      tag: 'agent-facets@0.4.0',
      runId: '123',
    })
    expect(watch).toHaveBeenCalledTimes(2)
    expect(io.shell.sleep).toHaveBeenCalledWith(2000)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  test('bounds retries and never redispatches when the watcher remains unavailable', async () => {
    const dispatch = spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('{"workflow_run_id":123}'))
    const watch = spyOn(io.gh, 'workflowWatch').mockResolvedValue(watchFailure('HTTP 404: Not Found'))
    const notify = mock(async () => {})
    expect(await dispatchAttestedRelease({ notify })).toEqual({
      ok: false,
      code: 'workflow-run-failed',
      tag: 'agent-facets@0.4.0',
      runId: '123',
    })
    expect(watch).toHaveBeenCalledTimes(5)
    expect(io.shell.sleep).toHaveBeenCalledTimes(4)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
  })

  test.each([
    'HTTP 401: Unauthorized',
    'HTTP 403: Forbidden',
  ])('does not retry permission errors: %s', async (diagnostic) => {
    spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('{"workflow_run_id":123}'))
    const watch = spyOn(io.gh, 'workflowWatch').mockResolvedValue(watchFailure(diagnostic))
    expect((await dispatchAttestedRelease()).ok).toBe(false)
    expect(watch).toHaveBeenCalledTimes(1)
    expect(io.shell.sleep).not.toHaveBeenCalled()
  })

  test('reuses a successful run even when a newer duplicate failed', async () => {
    spyOn(io.gh, 'workflowRuns').mockResolvedValue(
      shellResult(JSON.stringify([run(124, 'completed', 'failure'), run(123)])),
    )
    const dispatch = spyOn(io.gh, 'workflowDispatch')
    const watch = spyOn(io.gh, 'workflowWatch').mockResolvedValue(shellResult())
    expect(await dispatchAttestedRelease({ notify: async () => {} })).toEqual({
      ok: true,
      tag: 'agent-facets@0.4.0',
      runId: '123',
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(watch).toHaveBeenCalledWith('123')
    expect(io.gh.workflowRuns).toHaveBeenCalledWith('release-cli-assets.yml', 'agent-facets@0.4.0')
    expect(io.git.resolveCommit).toHaveBeenCalledWith('agent-facets@0.4.0')
  })

  test.each(['queued', 'in_progress'])('resumes watching an existing %s run', async (status) => {
    spyOn(io.gh, 'workflowRuns').mockResolvedValue(shellResult(JSON.stringify([run(123, status, '')])))
    const dispatch = spyOn(io.gh, 'workflowDispatch')
    spyOn(io.gh, 'workflowWatch').mockResolvedValue(shellResult())
    expect(await dispatchAttestedRelease({ notify: async () => {} })).toEqual({
      ok: true,
      tag: 'agent-facets@0.4.0',
      runId: '123',
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('does not reuse a successful run from another commit or a failed run', async () => {
    spyOn(io.gh, 'workflowRuns').mockResolvedValue(
      shellResult(JSON.stringify([run(124, 'completed', 'success', 'b'.repeat(40)), run(122, 'completed', 'failure')])),
    )
    const dispatch = spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('{"workflow_run_id":125}'))
    spyOn(io.gh, 'workflowWatch').mockResolvedValue(shellResult())
    expect(await dispatchAttestedRelease({ notify: async () => {} })).toEqual({
      ok: true,
      tag: 'agent-facets@0.4.0',
      runId: '125',
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  test.each([
    '{}',
    'not json',
    '[{"databaseId":"123"}]',
  ])('fails closed on invalid run inspection: %s', async (stdout) => {
    spyOn(io.gh, 'workflowRuns').mockResolvedValue(shellResult(stdout))
    const dispatch = spyOn(io.gh, 'workflowDispatch')
    expect(await dispatchAttestedRelease()).toEqual({
      ok: false,
      code: 'workflow-inspect-failed',
      tag: 'agent-facets@0.4.0',
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('fails closed if run listing fails', async () => {
    spyOn(io.gh, 'workflowRuns').mockResolvedValue(shellResult('', 1))
    const dispatch = spyOn(io.gh, 'workflowDispatch')
    expect((await dispatchAttestedRelease()).ok).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('fails closed if the tag cannot be resolved', async () => {
    spyOn(io.git, 'resolveCommit').mockResolvedValue(shellResult('', 1))
    const dispatch = spyOn(io.gh, 'workflowDispatch')
    expect((await dispatchAttestedRelease()).ok).toBe(false)
    expect(io.gh.workflowRuns).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('fails closed when dispatch does not return its exact workflow run ID', async () => {
    spyOn(io.gh, 'workflowDispatch').mockResolvedValue(shellResult('{}'))
    const watch = spyOn(io.gh, 'workflowWatch')

    expect(await dispatchAttestedRelease()).toEqual({
      ok: false,
      code: 'workflow-dispatch-response-invalid',
      tag: 'agent-facets@0.4.0',
    })
    expect(watch).not.toHaveBeenCalled()
  })
})
