import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as announce from '../lib/announce'
import * as ci from '../lib/ci'
import { SLACK_CHANNELS } from '../lib/constants'
import { io } from '../lib/io'
import { SAMPLE_CHANGELOG, shellResult, silenceIO } from '../lib/test-helpers'
import { finalize } from './finalize'

describe('finalize.ts', () => {
  beforeEach(() => {
    silenceIO()
  })

  afterEach(() => {
    mock.restore()
    delete process.env.CIRCLE_TAG
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
  })

  function setupFinalizePath() {
    spyOn(io, 'mintGitHubAppToken').mockResolvedValue('fake-gh-token')
    spyOn(io, 'publishCliPackage').mockResolvedValue(shellResult())
    spyOn(io, 'verifyCli').mockResolvedValue(shellResult())
    spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
      { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli' },
    ])
    spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
    spyOn(io, 'ghReleaseCreate').mockResolvedValue(
      'https://github.com/agent-facets/facets/releases/tag/agent-facets%400.4.0\n',
    )
    spyOn(announce, 'slackNotify').mockResolvedValue(undefined)
  }

  test('returns 1 when CIRCLE_TAG is not set', async () => {
    delete process.env.CIRCLE_TAG
    const code = await finalize()
    expect(code).toBe(1)
  })

  test('returns 1 for unparseable tag', async () => {
    process.env.CIRCLE_TAG = 'not-a-tag'
    const code = await finalize()
    expect(code).toBe(1)
  })

  test('runs the full publish → verify pipeline', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const mainPkgSpy = spyOn(io, 'publishCliPackage').mockResolvedValue(shellResult())
    const verifySpy = spyOn(io, 'verifyCli').mockResolvedValue(shellResult())

    const code = await finalize()

    expect(code).toBe(0)
    expect(mainPkgSpy).toHaveBeenCalledTimes(1)
    expect(verifySpy).toHaveBeenCalledTimes(1)
  })

  test('mints GitHub token for release creation', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const ghSpy = spyOn(io, 'mintGitHubAppToken').mockResolvedValue('gh-token')

    await finalize()

    expect(ghSpy).toHaveBeenCalledTimes(1)
    expect(process.env.GH_TOKEN).toBe('gh-token')
    expect(process.env.GITHUB_TOKEN).toBe('gh-token')
  })

  test('passes version to verify', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const verifySpy = spyOn(io, 'verifyCli').mockResolvedValue(shellResult())

    await finalize()

    expect(verifySpy).toHaveBeenCalledWith('0.4.0')
  })

  test('creates GitHub Release after verify', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const releaseSpy = spyOn(io, 'ghReleaseCreate').mockResolvedValue(
      'https://github.com/agent-facets/facets/releases/tag/agent-facets%400.4.0\n',
    )

    const code = await finalize()

    expect(code).toBe(0)
    expect(releaseSpy).toHaveBeenCalledTimes(1)
    const [tag, title] = releaseSpy.mock.calls[0] ?? []
    expect(tag).toBe('agent-facets@0.4.0')
    expect(title).toBe('agent-facets@0.4.0')
  })

  test('sends notification after release', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const slackSpy = spyOn(announce, 'slackNotify').mockResolvedValue(undefined)

    const code = await finalize()

    expect(code).toBe(0)
    expect(slackSpy).toHaveBeenCalledTimes(1)
    const [channel] = slackSpy.mock.calls[0] ?? []
    expect(channel).toBe(SLACK_CHANNELS.auto_cli_deploys)
  })

  test('continues even if GitHub Release creation fails', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()
    spyOn(io, 'readFile').mockRejectedValue(new Error('CHANGELOG.md not found'))

    const code = await finalize()

    expect(code).toBe(0)
  })

  test('continues even if notification fails', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()
    spyOn(announce, 'slackNotify').mockRejectedValue(new Error('Slack unavailable'))

    const code = await finalize()

    expect(code).toBe(0)
  })
})
