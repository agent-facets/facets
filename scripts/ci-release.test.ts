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

/** Set the branch for branch-aware routing in main() */
function setBranch(branch: string) {
  process.env.CIRCLE_BRANCH = branch
}

const SAMPLE_CHANGELOG = `# @agent-facets/core

## 0.2.0

### Minor Changes

- Added a cool new feature

## 0.1.0

### Minor Changes

- Initial release
`

describe('ci-release', () => {
  const originalCircleBranch = process.env.CIRCLE_BRANCH

  beforeEach(() => {
    setup()
  })

  afterEach(() => {
    mock.restore()
    if (originalCircleBranch === undefined) {
      delete process.env.CIRCLE_BRANCH
    } else {
      process.env.CIRCLE_BRANCH = originalCircleBranch
    }
  })

  describe('versionAndCreatePR', () => {
    /** Common mocks for the version+PR path */
    function setupVersionPath() {
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
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
      spyOn(io, 'writeFile').mockResolvedValue(0)
    }

    test('creates a new PR with rich body when changesets are pending', async () => {
      setBranch('main')
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md', 'README.md'])
      setupVersionPath()

      // Before versioning: v0.1.0, after versioning: v0.2.0
      const loadSpy = spyOn(io, 'loadWorkspacePackages')
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.1.0', dir: 'packages/core' }])
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' }])

      spyOn(io, 'ghPrList').mockResolvedValue('')
      const prCreateSpy = spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(loadSpy).toHaveBeenCalledTimes(2)
      expect(prCreateSpy).toHaveBeenCalledTimes(1)

      // Verify the PR body contains release info
      const body = prCreateSpy.mock.calls[0]?.[3] as string
      expect(body).toContain('# Releases')
      expect(body).toContain('## @agent-facets/core@0.2.0')
      expect(body).toContain('Added a cool new feature')
    })

    test('updates existing PR body instead of creating a new one', async () => {
      setBranch('main')
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      setupVersionPath()

      spyOn(io, 'loadWorkspacePackages')
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.1.0', dir: 'packages/core' }])
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' }])

      spyOn(io, 'ghPrList').mockResolvedValue('42\n')
      const prCreateSpy = spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())
      const prUpdateSpy = spyOn(io, 'ghPrUpdate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(prCreateSpy).not.toHaveBeenCalled()
      expect(prUpdateSpy).toHaveBeenCalledTimes(1)

      // Verify updated body contains release info
      const body = prUpdateSpy.mock.calls[0]?.[2] as string
      expect(body).toContain('# Releases')
      expect(body).toContain('## @agent-facets/core@0.2.0')
    })

    test('exits early when changeset version produces no diff', async () => {
      setBranch('main')
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '0.1.0', dir: 'packages/core' },
      ])
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

    test('sets both GH_TOKEN and GITHUB_TOKEN', async () => {
      setBranch('main')
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      setupVersionPath()

      spyOn(io, 'loadWorkspacePackages')
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.1.0', dir: 'packages/core' }])
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' }])

      spyOn(io, 'ghPrList').mockResolvedValue('')
      spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      await main()

      expect(process.env.GH_TOKEN).toBe('fake-gh-token')
      expect(process.env.GITHUB_TOKEN).toBe('fake-gh-token')
    })
  })

  describe('publish', () => {
    /** Common mocks to reach the publish path: on release branch + unpublished versions */
    function setupPublishPath() {
      setBranch('release')
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
    }

    /** Mock the sync-back-to-main flow (success path) */
    function setupSyncBack() {
      spyOn(io, 'gitFetch').mockResolvedValue(shellResult())
      spyOn(io, 'gitCheckout').mockResolvedValue(shellResult())
      spyOn(io, 'gitMerge').mockResolvedValue(shellResult())
      spyOn(io, 'gitPush').mockResolvedValue(shellResult())
    }

    test('mints OIDC token and publishes', async () => {
      setupPublishPath()
      setupSyncBack()

      const mintSpy = spyOn(io, 'mintOidcToken').mockResolvedValue('fake-oidc-token\n')
      const publishSpy = spyOn(io, 'changesetPublish').mockResolvedValue('')
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
      setupSyncBack()

      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('')
      const pushTagsSpy = spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(pushTagsSpy).toHaveBeenCalledWith('origin', 'release')
    })

    test('creates GitHub Releases for published packages', async () => {
      setupPublishPath()
      setupSyncBack()

      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('New tag:  @agent-facets/core@1.1.0\n')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG.replace('0.2.0', '1.1.0'))
      const releaseSpy = spyOn(io, 'ghReleaseCreate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(releaseSpy).toHaveBeenCalledTimes(1)

      // Verify tag and title
      const [tag, title] = releaseSpy.mock.calls[0] ?? []
      expect(tag).toBe('@agent-facets/core@1.1.0')
      expect(title).toBe('@agent-facets/core@1.1.0')
    })

    test('mints GitHub token in publish path for releases', async () => {
      setupPublishPath()
      setupSyncBack()

      const ghTokenSpy = spyOn(io, 'mintGitHubToken').mockResolvedValue('release-token')
      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      await main()

      expect(ghTokenSpy).toHaveBeenCalledTimes(1)
      expect(process.env.GH_TOKEN).toBe('release-token')
      expect(process.env.GITHUB_TOKEN).toBe('release-token')
    })

    test('continues publishing even if release creation fails', async () => {
      setupPublishPath()
      setupSyncBack()

      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('New tag:  @agent-facets/core@1.1.0\n')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())
      spyOn(io, 'readFile').mockRejectedValue(new Error('CHANGELOG.md not found'))
      spyOn(io, 'ghReleaseCreate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      // Should still succeed — release creation failure is non-fatal
      expect(code).toBe(0)
    })
  })

  describe('branch gating', () => {
    test('on main with no pending changesets, exits 0 without publishing', async () => {
      setBranch('main')
      spyOn(io, 'scanDir').mockResolvedValue(['README.md'])
      const npmSpy = spyOn(io, 'npmViewVersion')

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(npmSpy).not.toHaveBeenCalled()
    })

    test('on release with all versions published, exits 0', async () => {
      setBranch('release')
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
    })

    test('on a feature branch, exits 0 with no-op', async () => {
      setBranch('feature/cool-stuff')

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
    })

    test('with no CIRCLE_BRANCH set, exits 0 with no-op', async () => {
      delete process.env.CIRCLE_BRANCH

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
    })
  })

  describe('sync-back to main', () => {
    function setupPublishForSyncTest() {
      setBranch('release')
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())
    }

    test('merges release into main and pushes after publishing', async () => {
      setupPublishForSyncTest()

      const fetchSpy = spyOn(io, 'gitFetch').mockResolvedValue(shellResult())
      const checkoutSpy = spyOn(io, 'gitCheckout').mockResolvedValue(shellResult())
      const mergeSpy = spyOn(io, 'gitMerge').mockResolvedValue(shellResult())
      const pushSpy = spyOn(io, 'gitPush').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(fetchSpy).toHaveBeenCalledWith('origin', 'main')
      expect(checkoutSpy).toHaveBeenCalledWith('main')
      expect(mergeSpy).toHaveBeenCalledWith('release')
      expect(pushSpy).toHaveBeenCalledWith('origin', 'main', false)
    })

    test('creates fallback PR and notifies Slack when merge fails', async () => {
      setupPublishForSyncTest()

      spyOn(io, 'gitFetch').mockResolvedValue(shellResult())
      spyOn(io, 'gitCheckout').mockResolvedValue(shellResult())
      spyOn(io, 'gitMerge').mockRejectedValue(new Error('merge conflict'))
      spyOn(io, 'gitPush').mockResolvedValue(shellResult())

      const prListSpy = spyOn(io, 'ghPrListWithBase').mockResolvedValue('')
      const prCreateSpy = spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())
      const prUrlSpy = spyOn(io, 'ghPrUrl').mockResolvedValue('https://github.com/agent-facets/facets/pull/99\n')
      const slackSpy = spyOn(io, 'slackNotify').mockResolvedValue(undefined)

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(prListSpy).toHaveBeenCalledWith('release', 'main')
      expect(prCreateSpy).toHaveBeenCalledTimes(1)
      expect(prUrlSpy).toHaveBeenCalledWith('release', 'main')
      expect(slackSpy).toHaveBeenCalledTimes(1)
      expect(slackSpy.mock.calls[0]?.[1]).toContain('sync-back to main failed')
      expect(slackSpy.mock.calls[0]?.[1]).toContain('https://github.com/agent-facets/facets/pull/99')
    })

    test('skips creating fallback PR if one already exists', async () => {
      setupPublishForSyncTest()

      spyOn(io, 'gitFetch').mockResolvedValue(shellResult())
      spyOn(io, 'gitCheckout').mockResolvedValue(shellResult())
      spyOn(io, 'gitMerge').mockRejectedValue(new Error('merge conflict'))
      spyOn(io, 'gitPush').mockResolvedValue(shellResult())

      spyOn(io, 'ghPrListWithBase').mockResolvedValue('42')
      const prCreateSpy = spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())
      spyOn(io, 'ghPrUrl').mockResolvedValue('https://github.com/agent-facets/facets/pull/42\n')
      spyOn(io, 'slackNotify').mockResolvedValue(undefined)

      const { main } = await import('./ci-release')
      const code = await main()

      expect(code).toBe(0)
      expect(prCreateSpy).not.toHaveBeenCalled()
    })
  })

  describe('version PR targets release branch', () => {
    function setupVersionPath() {
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
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
      spyOn(io, 'writeFile').mockResolvedValue(0)
    }

    test('creates PR targeting release branch, not main', async () => {
      setBranch('main')
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      setupVersionPath()

      spyOn(io, 'loadWorkspacePackages')
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.1.0', dir: 'packages/core' }])
        .mockResolvedValueOnce([{ name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' }])

      spyOn(io, 'ghPrList').mockResolvedValue('')
      const prCreateSpy = spyOn(io, 'ghPrCreate').mockResolvedValue(shellResult())

      const { main } = await import('./ci-release')
      await main()

      // First arg to ghPrCreate is the base branch
      expect(prCreateSpy.mock.calls[0]?.[0]).toBe('release')
    })
  })

  describe('error handling', () => {
    test('returns 1 when changeset version fails', async () => {
      setBranch('main')
      spyOn(io, 'scanDir').mockResolvedValue(['funny-turtle.md'])
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '0.1.0', dir: 'packages/core' },
      ])
      spyOn(io, 'changesetVersion').mockRejectedValue(new Error('changeset version failed'))

      const { main } = await import('./ci-release')
      const code = await main().catch(() => 1)

      expect(code).toBe(1)
    })

    test('returns 1 when OIDC token minting fails', async () => {
      setBranch('release')
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      spyOn(io, 'mintOidcToken').mockRejectedValue(new Error('OIDC unavailable'))

      const { main } = await import('./ci-release')
      const code = await main().catch(() => 1)

      expect(code).toBe(1)
    })
  })
})
