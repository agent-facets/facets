import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { allTargets, CLI_WRAPPER_NAME, packageName } from './lib/build-cli'
import * as npm from './lib/npm'
import { promote } from './promote-cli'

const VERSION = '1.0.0'
const ALL_PACKAGES = [...allTargets.map(packageName), CLI_WRAPPER_NAME]

describe('promote-cli', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  test('promotes all 13 packages when none are at target version', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')
    const tagSpy = spyOn(npm, 'distTagAdd').mockResolvedValue(undefined)

    const code = await promote(VERSION)

    expect(code).toBe(0)
    expect(tagSpy).toHaveBeenCalledTimes(13)
  })

  test('skips all packages when already at target version', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue(VERSION)
    const tagSpy = spyOn(npm, 'distTagAdd').mockResolvedValue(undefined)

    const code = await promote(VERSION)

    expect(code).toBe(0)
    expect(tagSpy).not.toHaveBeenCalled()
  })

  test('only promotes packages not yet at target version', async () => {
    const alreadyPromoted = new Set([ALL_PACKAGES[0], ALL_PACKAGES[1]])

    spyOn(npm, 'latestVersion').mockImplementation(async (pkg: string) =>
      alreadyPromoted.has(pkg) ? VERSION : '0.9.0',
    )
    const tagSpy = spyOn(npm, 'distTagAdd').mockResolvedValue(undefined)

    const code = await promote(VERSION)

    expect(code).toBe(0)
    expect(tagSpy).toHaveBeenCalledTimes(11)
  })

  test('returns 1 when distTagAdd fails for a package', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')

    let callCount = 0
    spyOn(npm, 'distTagAdd').mockImplementation(async () => {
      callCount++
      if (callCount === 3) throw new Error('network error')
    })

    const code = await promote(VERSION)

    expect(code).toBe(1)
  })

  test('promotes all 13 packages (12 platform + wrapper)', async () => {
    const promotedPackages: string[] = []

    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')
    spyOn(npm, 'distTagAdd').mockImplementation(async (pkg: string) => {
      promotedPackages.push(pkg)
    })

    await promote(VERSION)

    const promotedSet = new Set(promotedPackages)
    for (const pkg of ALL_PACKAGES) {
      expect(promotedSet.has(pkg)).toBe(true)
    }
    expect(promotedSet.size).toBe(13)
  })
})
