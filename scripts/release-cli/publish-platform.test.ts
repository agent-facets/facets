import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import path from 'node:path'
import { DIST_DIR } from '../lib/constants'
import { io } from '../lib/io'
import * as npm from '../lib/npm'
import { shellResult } from '../lib/test-helpers'
import { publishSingle } from './publish-platform'

describe('publish-platform.ts', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    spyOn(io, 'mintCircleOidcToken').mockResolvedValue('fake-oidc-token\n')
  })

  afterEach(() => {
    mock.restore()
  })

  test('returns 1 when package.json cannot be read', async () => {
    spyOn(io, 'readJson').mockRejectedValue(new Error('ENOENT'))

    const code = await publishSingle('nonexistent-target')
    expect(code).toBe(1)
  })

  test('skips publish when version already exists on npm', async () => {
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-darwin-arm64',
      version: '1.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(true)
    const publishSpy = spyOn(io, 'publish').mockResolvedValue(shellResult())

    const code = await publishSingle('cli-darwin-arm64')

    expect(code).toBe(0)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test('runs chmod, pack, publish when version is not yet on npm', async () => {
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-linux-x64',
      version: '2.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    const chmodSpy = spyOn(io, 'chmod').mockResolvedValue(shellResult())
    const packSpy = spyOn(io, 'pack').mockResolvedValue(shellResult())
    const publishSpy = spyOn(io, 'publish').mockResolvedValue(shellResult())

    const code = await publishSingle('cli-linux-x64')

    expect(code).toBe(0)
    expect(chmodSpy).toHaveBeenCalledTimes(1)
    expect(packSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledTimes(1)
  })

  test('publishes to the latest dist-tag', async () => {
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-windows-x64',
      version: '3.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    spyOn(io, 'chmod').mockResolvedValue(shellResult())
    spyOn(io, 'pack').mockResolvedValue(shellResult())
    const publishSpy = spyOn(io, 'publish').mockResolvedValue(shellResult())

    await publishSingle('cli-windows-x64')

    expect(publishSpy.mock.calls[0]?.[1]).toBe('latest')
  })

  test('passes the correct package directory to pack and publish', async () => {
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-darwin-x64',
      version: '4.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    spyOn(io, 'chmod').mockResolvedValue(shellResult())
    const packSpy = spyOn(io, 'pack').mockResolvedValue(shellResult())
    const publishSpy = spyOn(io, 'publish').mockResolvedValue(shellResult())

    await publishSingle('cli-darwin-x64')

    const expectedDir = path.join(DIST_DIR, '@agent-facets', 'cli-darwin-x64')
    expect(packSpy.mock.calls[0]?.[0]).toBe(expectedDir)
    expect(publishSpy.mock.calls[0]?.[0]).toBe(expectedDir)
  })

  test('propagates error when publish throws', async () => {
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-linux-arm64',
      version: '6.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    spyOn(io, 'chmod').mockResolvedValue(shellResult())
    spyOn(io, 'pack').mockResolvedValue(shellResult())
    spyOn(io, 'publish').mockRejectedValue(new Error('npm publish failed'))

    await expect(publishSingle('cli-linux-arm64')).rejects.toThrow('npm publish failed')
  })

  test('checks versionExists with name and version from package.json', async () => {
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-linux-arm64',
      version: '5.0.0',
    })
    const versionSpy = spyOn(npm, 'versionExists').mockResolvedValue(true)

    await publishSingle('cli-linux-arm64')

    expect(versionSpy).toHaveBeenCalledWith('@agent-facets/cli-linux-arm64', '5.0.0')
  })
})
