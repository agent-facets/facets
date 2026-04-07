import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { MAIN_PACKAGE_NAME } from './lib/build-cli'
import { io } from './lib/io'
import * as npm from './lib/npm'
import { shellResult } from './lib/test-helpers'
import { publishMainPackage } from './publish-main-package'

describe('publish-main-package', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  test('returns 1 when no platform packages found in dist', async () => {
    // Mock Bun.Glob.scanSync to yield nothing — we override discoverPlatformPackages
    // by mocking io.readJson to throw (no files found)
    const globScanSpy = spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      // yield nothing
    })

    const code = await publishMainPackage()

    expect(code).toBe(1)
    globScanSpy.mockRestore()
  })

  test('skips publish when version already exists on npm', async () => {
    spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      yield '@agent-facets/cli-darwin-arm64/package.json'
    })
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-darwin-arm64',
      version: '1.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(true)
    const packSpy = spyOn(io, 'pack').mockResolvedValue(shellResult())

    const code = await publishMainPackage()

    expect(code).toBe(0)
    expect(packSpy).not.toHaveBeenCalled()
  })

  test('synthesizes package.json with correct optionalDependencies', async () => {
    spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      yield '@agent-facets/cli-darwin-arm64/package.json'
      yield '@agent-facets/cli-linux-x64/package.json'
    })
    let callIndex = 0
    spyOn(io, 'readJson').mockImplementation(async () => {
      callIndex++
      if (callIndex === 1) return { name: '@agent-facets/cli-darwin-arm64', version: '2.0.0' }
      return { name: '@agent-facets/cli-linux-x64', version: '2.0.0' }
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    const writeSpy = spyOn(io, 'writeFile').mockResolvedValue(0)
    spyOn(io, 'pack').mockResolvedValue(shellResult())
    spyOn(io, 'publish').mockResolvedValue(shellResult())

    await publishMainPackage()

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const written = JSON.parse(writeSpy.mock.calls[0]?.[1] as string)
    expect(written.name).toBe(MAIN_PACKAGE_NAME)
    expect(written.version).toBe('2.0.0')
    expect(written.optionalDependencies).toEqual({
      '@agent-facets/cli-darwin-arm64': '2.0.0',
      '@agent-facets/cli-linux-x64': '2.0.0',
    })
    expect(written.bin).toEqual({ facet: './bin/facet' })
  })

  test('calls pack and publish with staging tag', async () => {
    spyOn(Bun.Glob.prototype, 'scanSync').mockImplementation(function* () {
      yield '@agent-facets/cli-darwin-arm64/package.json'
    })
    spyOn(io, 'readJson').mockResolvedValue({
      name: '@agent-facets/cli-darwin-arm64',
      version: '3.0.0',
    })
    spyOn(npm, 'versionExists').mockResolvedValue(false)
    spyOn(io, 'writeFile').mockResolvedValue(0)
    const packSpy = spyOn(io, 'pack').mockResolvedValue(shellResult())
    const publishSpy = spyOn(io, 'publish').mockResolvedValue(shellResult())

    const code = await publishMainPackage()

    expect(code).toBe(0)
    expect(packSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy.mock.calls[0]?.[1]).toBe('staging')
  })
})
