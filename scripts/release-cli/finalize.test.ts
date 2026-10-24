import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import { io } from '../lib/io'
import { shellPromise, shellResult, silenceIO } from '../lib/test-helpers'
import { finalize } from './finalize'
import { platformPackageNames } from './targets'

describe('finalize.ts', () => {
  beforeEach(silenceIO)
  afterEach(() => {
    mock.restore()
    delete process.env.CIRCLE_TAG
  })

  function setupFinalizePath() {
    spyOn(io.shell, 'publishCliPackage').mockResolvedValue(shellResult())
    spyOn(io.shell, 'verifyPackages').mockResolvedValue(shellResult())
  }

  test('returns 1 when CIRCLE_TAG is not set', async () => {
    expect(await finalize()).toBe(1)
  })

  test('returns 1 for unparseable tag', async () => {
    process.env.CIRCLE_TAG = 'not-a-tag'
    expect(await finalize()).toBe(1)
  })

  test('verifies platforms, publishes CLI, then verifies the wrapper', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()
    const calls: string[] = []
    spyOn(io.shell, 'verifyPackages').mockImplementation(() => {
      calls.push('verify')
      return shellPromise()
    })
    spyOn(io.shell, 'publishCliPackage').mockImplementation(() => {
      calls.push('publish')
      return shellPromise()
    })

    expect(await finalize()).toBe(0)
    expect(calls).toEqual(['verify', 'publish', 'verify'])
  })

  test('passes the platform packages and wrapper version to readiness checks', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()
    const verify = spyOn(io.shell, 'verifyPackages')

    await finalize()

    expect(verify).toHaveBeenNthCalledWith(1, platformPackageNames(), '0.4.0')
    expect(verify).toHaveBeenNthCalledWith(2, [CLI_PACKAGE_NAME], '0.4.0')
  })

  test('does not publish the wrapper when platforms are unavailable', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()
    spyOn(io.shell, 'verifyPackages').mockResolvedValue(shellResult('', 1))
    const publish = spyOn(io.shell, 'publishCliPackage')

    expect(await finalize()).toBe(1)
    expect(publish).not.toHaveBeenCalled()
  })

  test('does not publish a GitHub Release or notify Slack', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    setupFinalizePath()
    const create = spyOn(io.gh, 'releaseCreate')
    const draft = spyOn(io.gh, 'releaseCreateDraft')

    expect(await finalize()).toBe(0)
    expect(create).not.toHaveBeenCalled()
    expect(draft).not.toHaveBeenCalled()
  })
})
