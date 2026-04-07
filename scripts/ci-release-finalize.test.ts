import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { finalize } from './ci-release-finalize'
import { io } from './lib/ci-io'
import { SLACK_CHANNELS } from './lib/constants'
import { SAMPLE_CHANGELOG, shellResult, silenceIO } from './lib/test-helpers'

describe('ci-release-finalize', () => {
  beforeEach(() => {
    silenceIO()
  })

  afterEach(() => {
    mock.restore()
    delete process.env.CIRCLE_TAG
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    delete process.env.NPM_ID_TOKEN
  })

  function setupFinalizePath() {
    spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
    spyOn(io, 'mintOidcToken').mockResolvedValue('fake-oidc-token\n')
    spyOn(io, 'publishMainPackage').mockResolvedValue(shellResult())
    spyOn(io, 'verifyCli').mockResolvedValue(shellResult())
    spyOn(io, 'promoteCli').mockResolvedValue(shellResult())
    spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
      { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli' },
    ])
    spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
    spyOn(io, 'ghReleaseCreate').mockResolvedValue(
      'https://github.com/agent-facets/facets/releases/tag/agent-facets%400.4.0\n',
    )
    spyOn(io, 'slackNotify').mockResolvedValue(undefined)
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

  test('runs the full publish → verify → promote pipeline', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const mainPkgSpy = spyOn(io, 'publishMainPackage').mockResolvedValue(shellResult())
    const verifySpy = spyOn(io, 'verifyCli').mockResolvedValue(shellResult())
    const promoteSpy = spyOn(io, 'promoteCli').mockResolvedValue(shellResult())

    const code = await finalize()

    expect(code).toBe(0)
    expect(mainPkgSpy).toHaveBeenCalledTimes(1)
    expect(verifySpy).toHaveBeenCalledTimes(1)
    expect(promoteSpy).toHaveBeenCalledTimes(1)
  })

  test('mints both GitHub and OIDC tokens', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const ghSpy = spyOn(io, 'mintGitHubToken').mockResolvedValue('gh-token')
    const oidcSpy = spyOn(io, 'mintOidcToken').mockResolvedValue('oidc-token\n')

    await finalize()

    expect(ghSpy).toHaveBeenCalledTimes(1)
    expect(oidcSpy).toHaveBeenCalledTimes(1)
    expect(process.env.GH_TOKEN).toBe('gh-token')
    expect(process.env.GITHUB_TOKEN).toBe('gh-token')
    expect(process.env.NPM_ID_TOKEN).toBe('oidc-token')
  })

  test('passes version to verify and promote', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const verifySpy = spyOn(io, 'verifyCli').mockResolvedValue(shellResult())
    const promoteSpy = spyOn(io, 'promoteCli').mockResolvedValue(shellResult())

    await finalize()

    expect(verifySpy).toHaveBeenCalledWith('0.4.0')
    expect(promoteSpy).toHaveBeenCalledWith('0.4.0')
  })

  test('creates GitHub Release after promote', async () => {
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

    const slackSpy = spyOn(io, 'slackNotify').mockResolvedValue(undefined)

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
    spyOn(io, 'slackNotify').mockRejectedValue(new Error('Slack unavailable'))

    const code = await finalize()

    expect(code).toBe(0)
  })
})
