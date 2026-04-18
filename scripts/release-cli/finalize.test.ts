import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as announce from '../lib/announce'
import * as ci from '../lib/ci'
import { CLI_PACKAGE_NAME, SLACK_CHANNELS } from '../lib/constants'
import { io } from '../lib/io'
import { SAMPLE_CHANGELOG, shellPromise, shellResult, silenceIO } from '../lib/test-helpers'
import { finalize } from './finalize'
import { platformPackageNames } from './targets'

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
    spyOn(io, 'verifyPackages').mockResolvedValue(shellResult())
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

  test('runs the full verify → publish → verify pipeline', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const publishSpy = spyOn(io, 'publishCliPackage').mockResolvedValue(shellResult())
    const verifySpy = spyOn(io, 'verifyPackages').mockResolvedValue(shellResult())

    const code = await finalize()

    expect(code).toBe(0)
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(verifySpy).toHaveBeenCalledTimes(2)
  })

  test('verifies platforms, publishes CLI, then verifies CLI wrapper', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const callOrder: Array<{ phase: string; args?: unknown[] }> = []
    spyOn(io, 'verifyPackages').mockImplementation((packages: string[], version: string) => {
      callOrder.push({ phase: 'verify', args: [packages, version] })
      return shellPromise()
    })
    spyOn(io, 'publishCliPackage').mockImplementation(() => {
      callOrder.push({ phase: 'publish' })
      return shellPromise()
    })

    await finalize()

    expect(callOrder.map((c) => c.phase)).toEqual(['verify', 'publish', 'verify'])

    // First verify call: the 12 platform packages
    const firstVerifyArgs = callOrder[0]?.args
    expect(firstVerifyArgs?.[0]).toEqual(platformPackageNames())
    expect(firstVerifyArgs?.[1]).toBe('0.4.0')

    // Second verify call: just the CLI wrapper
    const secondVerifyArgs = callOrder[2]?.args
    expect(secondVerifyArgs?.[0]).toEqual([CLI_PACKAGE_NAME])
    expect(secondVerifyArgs?.[1]).toBe('0.4.0')
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

  test('passes version and correct package list to both verify calls', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()

    const verifySpy = spyOn(io, 'verifyPackages').mockResolvedValue(shellResult())

    await finalize()

    expect(verifySpy).toHaveBeenCalledTimes(2)
    expect(verifySpy).toHaveBeenNthCalledWith(1, platformPackageNames(), '0.4.0')
    expect(verifySpy).toHaveBeenNthCalledWith(2, [CLI_PACKAGE_NAME], '0.4.0')
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
