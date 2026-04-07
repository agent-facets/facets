import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { allPackageNames } from './lib/build-cli'
import * as npm from './lib/npm'
import { promote } from './promote-cli'

const VERSION = '1.0.0'
const OIDC_JWT = 'fake-oidc-jwt'
const NPM_TOKEN = 'fake-npm-token'
const ALL_PACKAGES = allPackageNames()

describe('promote-cli', () => {
  beforeEach(() => {
    process.env.NPM_ID_TOKEN = OIDC_JWT
    spyOn(console, 'log').mockImplementation(() => {})
    spyOn(console, 'error').mockImplementation(() => {})
    spyOn(npm, 'exchangeOidcToken').mockResolvedValue(NPM_TOKEN)
  })

  afterEach(() => {
    delete process.env.NPM_ID_TOKEN
    mock.restore()
  })

  test('returns 1 when NPM_ID_TOKEN is not set', async () => {
    delete process.env.NPM_ID_TOKEN
    const code = await promote(VERSION)
    expect(code).toBe(1)
  })

  test('promotes all 13 packages when none are at target version', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')
    const tagSpy = spyOn(npm, 'addDistTagViaApi').mockResolvedValue(undefined)

    const code = await promote(VERSION)

    expect(code).toBe(0)
    expect(tagSpy).toHaveBeenCalledTimes(13)
  })

  test('exchanges OIDC token per package before adding dist-tag', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')
    const exchangeSpy = spyOn(npm, 'exchangeOidcToken').mockResolvedValue(NPM_TOKEN)
    const tagSpy = spyOn(npm, 'addDistTagViaApi').mockResolvedValue(undefined)

    await promote(VERSION)

    expect(exchangeSpy).toHaveBeenCalledTimes(13)
    // Each call should pass the OIDC JWT
    for (const call of exchangeSpy.mock.calls) {
      expect(call[1]).toBe(OIDC_JWT)
    }
    // Each dist-tag call should use the exchanged npm token
    for (const call of tagSpy.mock.calls) {
      expect(call[3]).toBe(NPM_TOKEN)
    }
  })

  test('skips all packages when already at target version', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue(VERSION)
    const tagSpy = spyOn(npm, 'addDistTagViaApi').mockResolvedValue(undefined)

    const code = await promote(VERSION)

    expect(code).toBe(0)
    expect(tagSpy).not.toHaveBeenCalled()
  })

  test('only promotes packages not yet at target version', async () => {
    const alreadyPromoted = new Set([ALL_PACKAGES[0], ALL_PACKAGES[1]])

    spyOn(npm, 'latestVersion').mockImplementation(async (pkg: string) =>
      alreadyPromoted.has(pkg) ? VERSION : '0.9.0',
    )
    const tagSpy = spyOn(npm, 'addDistTagViaApi').mockResolvedValue(undefined)

    const code = await promote(VERSION)

    expect(code).toBe(0)
    expect(tagSpy).toHaveBeenCalledTimes(11)
  })

  test('returns 1 when exchangeOidcToken fails for a package', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')

    let callCount = 0
    spyOn(npm, 'exchangeOidcToken').mockImplementation(async () => {
      callCount++
      if (callCount === 3) throw new Error('OIDC exchange failed')
      return NPM_TOKEN
    })
    spyOn(npm, 'addDistTagViaApi').mockResolvedValue(undefined)

    const code = await promote(VERSION)

    expect(code).toBe(1)
  })

  test('returns 1 when addDistTagViaApi fails for a package', async () => {
    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')

    let callCount = 0
    spyOn(npm, 'addDistTagViaApi').mockImplementation(async () => {
      callCount++
      if (callCount === 3) throw new Error('network error')
    })

    const code = await promote(VERSION)

    expect(code).toBe(1)
  })

  test('promotes all 13 packages (12 platform + main)', async () => {
    const promotedPackages: string[] = []

    spyOn(npm, 'latestVersion').mockResolvedValue('0.9.0')
    spyOn(npm, 'addDistTagViaApi').mockImplementation(async (pkg: string) => {
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
