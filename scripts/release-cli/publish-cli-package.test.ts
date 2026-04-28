import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import { io } from '../lib/io'
import * as npm from '../lib/npm'
import { publishCliPackage } from './publish-cli-package'

describe('publish-cli-package.ts', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    spyOn(io.shell, 'mintCircleOidcToken').mockResolvedValue('fake-oidc-token\n')
  })

  afterEach(() => {
    mock.restore()
  })

  test('returns 1 when no platform packages found in dist', async () => {
    const globScanSpy = spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      // yield nothing
    })

    const code = await publishCliPackage()

    expect(code).toBe(1)
    globScanSpy.mockRestore()
  })

  test('skips publish when version already exists on npm', async () => {
    spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      yield '@agent-facets/cli-darwin-arm64/package.json'
    })
    spyOn(io.shell, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-darwin-arm64',
      version: '1.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(true)
    const publishSpy = spyOn(npm, 'packAndPublish').mockResolvedValue(undefined)

    const code = await publishCliPackage()

    expect(code).toBe(0)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  test('synthesizes package.json with correct optionalDependencies', async () => {
    spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      yield '@agent-facets/cli-darwin-arm64/package.json'
      yield '@agent-facets/cli-linux-x64/package.json'
    })
    let callIndex = 0
    spyOn(io.shell, 'readJson').mockImplementation(async () => {
      callIndex++
      if (callIndex === 1) return { name: '@agent-facets/cli-darwin-arm64', version: '2.0.0' }
      return { name: '@agent-facets/cli-linux-x64', version: '2.0.0' }
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    const writeSpy = spyOn(io.shell, 'writeFile').mockResolvedValue(0)
    spyOn(npm, 'packAndPublish').mockResolvedValue(undefined)

    await publishCliPackage()

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const written = JSON.parse(writeSpy.mock.calls[0]?.[1] as string)
    expect(written.name).toBe(CLI_PACKAGE_NAME)
    expect(written.version).toBe('2.0.0')
    expect(written.optionalDependencies).toEqual({
      '@agent-facets/cli-darwin-arm64': '2.0.0',
      '@agent-facets/cli-linux-x64': '2.0.0',
    })
    expect(written.bin).toEqual({ facet: './bin/facet' })
  })

  test('calls packAndPublish with latest tag', async () => {
    spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      yield '@agent-facets/cli-darwin-arm64/package.json'
    })
    spyOn(io.shell, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-darwin-arm64',
      version: '3.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    spyOn(io.shell, 'writeFile').mockResolvedValue(0)
    const publishSpy = spyOn(npm, 'packAndPublish').mockResolvedValue(undefined)

    const code = await publishCliPackage()

    expect(code).toBe(0)
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy.mock.calls[0]?.[1]).toBe('latest')
  })
})
