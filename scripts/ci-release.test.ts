import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from './lib/ci-io'

/** Helper: fake a successful Bun.$ shell result */
// biome-ignore lint/suspicious/noExplicitAny: mocking Bun.$ ShellOutput for tests
function shellResult(stdout = '', exitCode = 0): any {
  return { stdout: Buffer.from(stdout), exitCode }
}

/** Silence logging and set up default mocks for all IO methods */
function setup() {
  spyOn(io, 'log').mockImplementation(() => {})
  spyOn(io, 'error').mockImplementation(() => {})
}

describe('ci-release', () => {
  beforeEach(() => {
    setup()
  })

  afterEach(() => {
    mock.restore()
  })

  describe('versionAndCreatePR', () => {
    test('creates a new PR when changesets are pending', async () => {
      // Mock: pending changesets exist
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md', 'README.md'])

      // Mock: GitHub App token
      const ghTokenSpy = spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')

      // Mock: changeset version + install
      const versionSpy = spyOn(io, 'changesetVersion').mockResolvedValue(shellResult())
      spyOn(io, 'bunInstall').mockResolvedValue(shellResult())

      // Mock: git diff shows changes
      spyOn(io, 'gitDiff').mockResolvedValue(shellResult('', 1))
      spyOn(io, 'gitDiffCached').mockResolvedValue(shellResult('', 0))

      // Mock: git operations
      spyOn(io, 'gitConfig').mockResolvedValue(shellResult())
      spyOn(io, 'gitCheckout').mockResolvedValue(shellResult())
      spyOn(io, 'gitAdd').mockResolvedValue(shellResult())
      spyOn(io, 'gitCommit').mockResolvedValue(shellResult())
      spyOn(io, 'gitPush').mockResolvedValue(shellResult())

      // Mock: no existing PR
      spyOn(io, 'ghPrList').mockResolvedValue('')
      const prCreateSpy = spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(ghTokenSpy).toHaveBeenCalledTimes(1)
      expect(process.env.GH_TOKEN).toBe('fake-gh-token')
      expect(versionSpy).toHaveBeenCalledTimes(1)
      expect(prCreateSpy).toHaveBeenCalledTimes(1)
    })

    test('updates existing PR instead of creating a new one', async () => {
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'changesetVersion').mockResolvedValue(shellResult())
      spyOn(io, 'bunInstall').mockResolvedValue(shellResult())
      spyOn(io, 'gitDiff').mockResolvedValue(shellResult('', 1))
      spyOn(io, 'gitDiffCached').mockResolvedValue(shellResult('', 0))
      spyOn(io, 'gitConfig').mockResolvedValue(shellResult())
      spyOn(io, 'gitCheckout').mockResolvedValue(shellResult())
      spyOn(io, 'gitAdd').mockResolvedValue(shellResult())
      spyOn(io, 'gitCommit').mockResolvedValue(shellResult())
      spyOn(io, 'gitPush').mockResolvedValue(shellResult())

      // Mock: existing PR found
      spyOn(io, 'ghPrList').mockResolvedValue('42\n')
      const prCreateSpy = spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(prCreateSpy).not.toHaveBeenCalled()
    })

    test('exits early when changeset version produces no diff', async () => {
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'changesetVersion').mockResolvedValue(shellResult())
      spyOn(io, 'bunInstall').mockResolvedValue(shellResult())

      // Mock: no changes after versioning
      spyOn(io, 'gitDiff').mockResolvedValue(shellResult('', 0))
      spyOn(io, 'gitDiffCached').mockResolvedValue(shellResult('', 0))

      const gitCheckoutSpy = spyOn(io, 'gitCheckout').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(gitCheckoutSpy).not.toHaveBeenCalled()
    })
  })

  describe('publish', () => {
    /** Common mocks to reach the publish path: no pending changesets + unpublished versions */
    function setupPublishPath() {
      spyOn(io, 'scanDir').mockResolvedValue(['README.md'])
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
    }

    test('mints OIDC token and publishes', async () => {
      setupPublishPath()

      // Mock: OIDC + publish
      const mintSpy = spyOn(io, 'mintOidcToken').mockResolvedValue('fake-oidc-token\n')
      const publishSpy = spyOn(io, 'changesetPublish').mockResolvedValue(shellResult())
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(mintSpy).toHaveBeenCalledTimes(1)
      expect(publishSpy).toHaveBeenCalledTimes(1)
      expect(process.env.NPM_ID_TOKEN).toBe('fake-oidc-token')
    })

    test('pushes tags after publishing', async () => {
      setupPublishPath()

      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue(shellResult())
      const pushTagsSpy = spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(pushTagsSpy).toHaveBeenCalledWith('origin', 'main')
    })
  })

  describe('error handling', () => {
    test('returns 1 when changeset version fails', async () => {
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'changesetVersion').mockRejectedValue(new Error('changeset version failed'))

      const { main } = await import('./ci-release')
      const code = await main().catch(() => 1)

      expect(code).toBe(1)
    })

    test('returns 1 when OIDC token minting fails', async () => {
      spyOn(io, 'scanDir').mockResolvedValue([])
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      spyOn(io, 'mintOidcToken').mockRejectedValue(new Error('OIDC unavailable'))

      const { main } = await import('./ci-release')
      const code = await main().catch(() => 1)

      expect(code).toBe(1)
    })
  })
})
