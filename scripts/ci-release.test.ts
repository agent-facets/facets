import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import dedent from 'dedent'
import { io } from './lib/ci-io'
import { ALL_SLACK_CHANNELS } from './lib/constants'
import { SAMPLE_CHANGELOG, shellResult, silenceIO } from './lib/test-helpers'

describe('ci-release', () => {
  beforeEach(() => {
    silenceIO()
  })

  afterEach(() => {
    mock.restore()
  })

  describe('release', () => {
    function setupPublishPath() {
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      spyOn(io, 'slackNotify').mockResolvedValue(undefined)
    }

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

      const { release } = await import('./ci-release')
      const code = await release()

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

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(pushTagsSpy).toHaveBeenCalledWith('origin', 'release')
    })

    test('creates GitHub Releases for published packages', async () => {
      setupPublishPath()
      setupSyncBack()

      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('New tag:  @agent-facets/core@1.1.0\n')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
      const releaseSpy = spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/%40agent-facets%2Fcore%401.1.0\n',
      )

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(releaseSpy).toHaveBeenCalledTimes(1)

      const [tag, title] = releaseSpy.mock.calls[0] ?? []
      expect(tag).toBe('@agent-facets/core@1.1.0')
      expect(title).toBe('@agent-facets/core@1.1.0')
    })

    test('mints GitHub token for releases', async () => {
      setupPublishPath()
      setupSyncBack()

      const ghTokenSpy = spyOn(io, 'mintGitHubToken').mockResolvedValue('release-token')
      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())

      const { release } = await import('./ci-release')
      await release()

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
      spyOn(io, 'ghReleaseCreate').mockResolvedValue('')

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
    })

    test('sends Slack notification with release URLs after publishing', async () => {
      setupPublishPath()
      setupSyncBack()

      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('New tag:  @agent-facets/core@1.1.0\n')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
      spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/%40agent-facets%2Fcore%401.1.0\n',
      )
      const slackSpy = spyOn(io, 'slackNotify').mockResolvedValue(undefined)

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(slackSpy).toHaveBeenCalledTimes(1)
      const [channels, message] = slackSpy.mock.calls[0] ?? []
      expect(channels).toBe(ALL_SLACK_CHANNELS)
      expect(message).toBe(dedent`
        🚀 Published 1 release(s):
        • <https://github.com/agent-facets/facets/releases/tag/%40agent-facets%2Fcore%401.1.0|@agent-facets/core@1.1.0>
      `)
    })

    test('does not send release notification when no packages are published', async () => {
      setupPublishPath()
      setupSyncBack()

      spyOn(io, 'mintOidcToken').mockResolvedValue('token\n')
      spyOn(io, 'changesetPublish').mockResolvedValue('No packages to publish\n')
      spyOn(io, 'gitPushTags').mockResolvedValue(shellResult())
      const slackSpy = spyOn(io, 'slackNotify').mockResolvedValue(undefined)

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(slackSpy).not.toHaveBeenCalled()
    })
  })

  describe('all versions already published', () => {
    test('exits 0 when nothing to publish', async () => {
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
    })
  })

  describe('sync-back to main', () => {
    function setupPublishForSyncTest() {
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

      const { release } = await import('./ci-release')
      const code = await release()

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

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(prListSpy).toHaveBeenCalledWith('release', 'main')
      expect(prCreateSpy).toHaveBeenCalledTimes(1)
      expect(prUrlSpy).toHaveBeenCalledWith('release', 'main')
      expect(slackSpy).toHaveBeenCalledTimes(1)
      expect(slackSpy.mock.calls[0]?.[1]).toBe(
        '⚠️ Release published successfully, but sync-back to main failed. PR created: https://github.com/agent-facets/facets/pull/99',
      )
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

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(prCreateSpy).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    test('returns 1 when OIDC token minting fails', async () => {
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      spyOn(io, 'mintOidcToken').mockRejectedValue(new Error('OIDC unavailable'))

      const { release } = await import('./ci-release')
      const code = await release().catch(() => 1)

      expect(code).toBe(1)
    })
  })
})
