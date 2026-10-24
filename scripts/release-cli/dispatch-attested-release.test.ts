import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from '../lib/io'
import { shellResult, silenceIO } from '../lib/test-helpers'
import { dispatchAttestedRelease } from './dispatch-attested-release'

describe('dispatch-attested-release.ts', () => {
  beforeEach(() => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    silenceIO()
    spyOn(io.shell, 'mintGitHubAppToken').mockResolvedValue('token')
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
    spyOn(io.gh, 'workflowWatch').mockResolvedValue(shellResult('', 1))
    const notify = mock(() => Promise.resolve())

    expect(await dispatchAttestedRelease({ notify })).toEqual({
      ok: false,
      code: 'workflow-run-failed',
      tag: 'agent-facets@0.4.0',
      runId: '123',
    })
    expect(notify).not.toHaveBeenCalled()
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
