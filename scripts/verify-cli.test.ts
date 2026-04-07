import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { allTargets, CLI_WRAPPER_NAME, packageName } from './lib/build-cli'
import * as npm from './lib/npm'
import { verify } from './verify-cli'

const VERSION = '1.0.0'
const ALL_PACKAGES = [...allTargets.map(packageName), CLI_WRAPPER_NAME]

describe('verify-cli', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  test('returns 0 when all packages are found on first attempt', async () => {
    spyOn(npm, 'versionExists').mockResolvedValue(true)

    const code = await verify(VERSION, 0)

    expect(code).toBe(0)
  })

  test('verifies all 13 packages (12 platform + wrapper)', async () => {
    const veSpy = spyOn(npm, 'versionExists').mockResolvedValue(true)

    await verify(VERSION, 0)

    const checkedPackages = new Set(veSpy.mock.calls.map(([pkg]) => pkg))
    for (const pkg of ALL_PACKAGES) {
      expect(checkedPackages.has(pkg)).toBe(true)
    }
    expect(checkedPackages.size).toBe(13)
  })

  test('retries when some packages are missing, succeeds when they appear', async () => {
    const missingPkg = ALL_PACKAGES[0]
    let attempt = 0

    spyOn(npm, 'versionExists').mockImplementation(async (pkg: string) => {
      if (pkg === missingPkg && attempt === 0) {
        attempt = 1
        return false
      }
      return true
    })

    const code = await verify(VERSION, 0)

    expect(code).toBe(0)
  })

  test('returns 1 after max retries when packages remain missing', async () => {
    const missing = new Set([ALL_PACKAGES[0], ALL_PACKAGES[1]])

    spyOn(npm, 'versionExists').mockImplementation(async (pkg: string) => !missing.has(pkg))

    const code = await verify(VERSION, 0)

    expect(code).toBe(1)
  })

  test('only retries packages that were missing, not already-verified ones', async () => {
    const missingPkg = ALL_PACKAGES[0]
    const callCounts = new Map<string, number>()

    spyOn(npm, 'versionExists').mockImplementation(async (pkg: string) => {
      callCounts.set(pkg, (callCounts.get(pkg) ?? 0) + 1)
      return pkg !== missingPkg
    })

    await verify(VERSION, 0)

    // Non-missing packages should only be checked once
    for (const pkg of ALL_PACKAGES) {
      if (pkg !== missingPkg) {
        expect(callCounts.get(pkg)).toBe(1)
      }
    }

    // The missing package should be checked on every attempt (initial + MAX_RETRIES = 6)
    expect(callCounts.get(missingPkg ?? '')).toBeGreaterThan(1)
  })
})
