import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import * as npm from '../lib/npm'
import { allPackageNames, platformPackageNames } from './targets'
import { verify } from './verify'

const VERSION = '1.0.0'
const ALL_PACKAGES = allPackageNames()
const PLATFORM_PACKAGES = platformPackageNames()

describe('verify.ts', () => {
  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  test('returns 0 when all packages are found on first attempt', async () => {
    const veSpy = spyOn(npm, 'versionExists').mockResolvedValue(true)

    const code = await verify(ALL_PACKAGES, VERSION, 0)

    expect(code).toBe(0)
    expect(veSpy).toHaveBeenCalledTimes(ALL_PACKAGES.length)
  })

  test('verifies all 13 packages (12 platform + main) when given the full list', async () => {
    const veSpy = spyOn(npm, 'versionExists').mockResolvedValue(true)

    await verify(ALL_PACKAGES, VERSION, 0)

    const checkedPackages = new Set(veSpy.mock.calls.map(([pkg]) => pkg))
    for (const pkg of ALL_PACKAGES) {
      expect(checkedPackages.has(pkg)).toBe(true)
    }
    expect(checkedPackages.size).toBe(13)
  })

  test('verifies only the packages provided in the list (platform-only path)', async () => {
    const veSpy = spyOn(npm, 'versionExists').mockResolvedValue(true)

    await verify(PLATFORM_PACKAGES, VERSION, 0)

    const checkedPackages = new Set(veSpy.mock.calls.map(([pkg]) => pkg))
    expect(checkedPackages.size).toBe(12)
    for (const pkg of PLATFORM_PACKAGES) {
      expect(checkedPackages.has(pkg)).toBe(true)
    }
    // CLI wrapper must not be checked when only platforms are passed
    expect(checkedPackages.has(CLI_PACKAGE_NAME)).toBe(false)
  })

  test('verifies a single package (CLI wrapper path)', async () => {
    const veSpy = spyOn(npm, 'versionExists').mockResolvedValue(true)

    await verify([CLI_PACKAGE_NAME], VERSION, 0)

    const checkedPackages = new Set(veSpy.mock.calls.map(([pkg]) => pkg))
    expect(checkedPackages.size).toBe(1)
    expect(checkedPackages.has(CLI_PACKAGE_NAME)).toBe(true)
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

    const code = await verify(ALL_PACKAGES, VERSION, 0)

    expect(code).toBe(0)
  })

  test('succeeds when a package first appears on the final (ninth) check', async () => {
    const lateCheck = 9
    let checks = 0

    spyOn(npm, 'versionExists').mockImplementation(async () => {
      checks++
      return checks === lateCheck
    })

    const code = await verify([CLI_PACKAGE_NAME], VERSION, 0)

    expect(code).toBe(0)
    expect(checks).toBe(lateCheck)
  })

  test('returns 1 after exactly nine checks when a package remains missing', async () => {
    const veSpy = spyOn(npm, 'versionExists').mockResolvedValue(false)

    const code = await verify([CLI_PACKAGE_NAME], VERSION, 0)

    expect(code).toBe(1)
    // Initial check + MAX_RETRIES (8)
    expect(veSpy).toHaveBeenCalledTimes(9)
  })

  test('returns 1 after max retries when packages remain missing', async () => {
    const missing = new Set([ALL_PACKAGES[0], ALL_PACKAGES[1]])

    spyOn(npm, 'versionExists').mockImplementation(async (pkg: string) => !missing.has(pkg))

    const code = await verify(ALL_PACKAGES, VERSION, 0)

    expect(code).toBe(1)
  })

  test('only retries packages that were missing, not already-verified ones', async () => {
    const missingPkg = ALL_PACKAGES[0]
    const callCounts = new Map<string, number>()

    spyOn(npm, 'versionExists').mockImplementation(async (pkg: string) => {
      callCounts.set(pkg, (callCounts.get(pkg) ?? 0) + 1)
      return pkg !== missingPkg
    })

    await verify(ALL_PACKAGES, VERSION, 0)

    // Non-missing packages should only be checked once
    for (const pkg of ALL_PACKAGES) {
      if (pkg !== missingPkg) {
        expect(callCounts.get(pkg)).toBe(1)
      }
    }

    // The missing package should be checked on every attempt (initial + MAX_RETRIES = 9)
    expect(callCounts.get(missingPkg ?? '')).toBe(9)
  })
})
