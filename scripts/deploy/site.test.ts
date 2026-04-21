import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from '../lib/io'
import { shellPromise, silenceIO } from '../lib/test-helpers'
import { deploySite } from './site'

describe('site.ts', () => {
  beforeEach(() => {
    silenceIO()
  })

  afterEach(() => {
    mock.restore()
    delete process.env.AWS_ACCESS_KEY_ID
  })

  test('returns 1 when AWS_ACCESS_KEY_ID is not set', async () => {
    delete process.env.AWS_ACCESS_KEY_ID
    const code = await deploySite()
    expect(code).toBe(1)
  })

  test('runs sst install, then sst deploy, then returns 0', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAFAKE'
    const callOrder: string[] = []

    const installSpy = spyOn(io.shell, 'sstInstall').mockImplementation(() => {
      callOrder.push('install')
      return shellPromise()
    })
    const deploySpy = spyOn(io.shell, 'sstDeployMain').mockImplementation(() => {
      callOrder.push('deploy')
      return shellPromise()
    })

    const code = await deploySite()

    expect(code).toBe(0)
    expect(installSpy).toHaveBeenCalledTimes(1)
    expect(deploySpy).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['install', 'deploy'])
  })

  test('does not run sst deploy if AWS credentials are missing', async () => {
    delete process.env.AWS_ACCESS_KEY_ID

    const installSpy = spyOn(io.shell, 'sstInstall').mockImplementation(() => shellPromise())
    const deploySpy = spyOn(io.shell, 'sstDeployMain').mockImplementation(() => shellPromise())

    await deploySite()

    expect(installSpy).not.toHaveBeenCalled()
    expect(deploySpy).not.toHaveBeenCalled()
  })
})
