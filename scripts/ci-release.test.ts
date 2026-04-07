import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { parseTag } from './ci-release'
import { io } from './lib/ci-io'
import { SLACK_CHANNELS } from './lib/constants'
import { SAMPLE_CHANGELOG, shellResult, silenceIO } from './lib/test-helpers'

describe('ci-release', () => {
  beforeEach(() => {
    silenceIO()
  })

  afterEach(() => {
    mock.restore()
    delete process.env.CIRCLE_TAG
  })

  describe('parseTag', () => {
    test('parses scoped package tag', () => {
      expect(parseTag('@agent-facets/core@1.2.3')).toEqual({ name: '@agent-facets/core', version: '1.2.3' })
    })

    test('parses unscoped package tag', () => {
      expect(parseTag('agent-facets@0.4.0')).toEqual({ name: 'agent-facets', version: '0.4.0' })
    })

    test('parses pre-release version', () => {
      expect(parseTag('@agent-facets/core@1.0.0-beta.1')).toEqual({
        name: '@agent-facets/core',
        version: '1.0.0-beta.1',
      })
    })

    test('returns null for invalid tag', () => {
      expect(parseTag('not-a-version-tag')).toBeNull()
    })

    test('returns null for empty string', () => {
      expect(parseTag('')).toBeNull()
    })
  })

  describe('release', () => {
    function setupPublishPath() {
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      spyOn(io, 'mintOidcToken').mockResolvedValue('fake-oidc-token\n')
      spyOn(io, 'npmPublish').mockResolvedValue(shellResult())
      spyOn(io, 'slackNotify').mockResolvedValue(undefined)
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
      spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/%40agent-facets%2Fcore%401.1.0\n',
      )
    }

    test('returns 1 when CIRCLE_TAG is not set', async () => {
      delete process.env.CIRCLE_TAG

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(1)
    })

    test('returns 1 for unparseable tag', async () => {
      process.env.CIRCLE_TAG = 'not-a-tag'

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(1)
    })

    test('returns 1 when package not found in workspace', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/nonexistent@1.0.0'
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(1)
    })

    test('returns 1 when version mismatches', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@9.9.9'
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(1)
    })

    test('publishes non-private package to npm', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()

      const publishSpy = spyOn(io, 'npmPublish').mockResolvedValue(shellResult())

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(publishSpy).toHaveBeenCalledWith('packages/core')
    })

    test('mints OIDC token before npm publish', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()

      const mintSpy = spyOn(io, 'mintOidcToken').mockResolvedValue('oidc-token\n')

      const { release } = await import('./ci-release')
      await release()

      expect(mintSpy).toHaveBeenCalledTimes(1)
      expect(process.env.NPM_ID_TOKEN).toBe('oidc-token')
    })

    test('creates GitHub Release after npm publish', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()

      const releaseSpy = spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/core\n',
      )

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(releaseSpy).toHaveBeenCalledTimes(1)
      const [tag, title] = releaseSpy.mock.calls[0] ?? []
      expect(tag).toBe('@agent-facets/core@1.1.0')
      expect(title).toBe('@agent-facets/core@1.1.0')
    })

    test('sends Slack notification to deploy channel only', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()

      const slackSpy = spyOn(io, 'slackNotify').mockResolvedValue(undefined)

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(slackSpy).toHaveBeenCalledTimes(1)
      const [channel] = slackSpy.mock.calls[0] ?? []
      expect(channel).toBe(SLACK_CHANNELS.auto_cli_deploys)
    })

    test('sets both GH_TOKEN and GITHUB_TOKEN', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      spyOn(io, 'mintGitHubToken').mockResolvedValue('release-token')

      const { release } = await import('./ci-release')
      await release()

      expect(process.env.GH_TOKEN).toBe('release-token')
      expect(process.env.GITHUB_TOKEN).toBe('release-token')
    })

    test('continues even if GitHub Release creation fails', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      spyOn(io, 'readFile').mockRejectedValue(new Error('CHANGELOG.md not found'))

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
    })

    test('continues even if Slack notification fails', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      spyOn(io, 'slackNotify').mockRejectedValue(new Error('Slack unavailable'))

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
    })
  })

  describe('CLI wrapper (agent-facets)', () => {
    function setupCliReleasePath() {
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli' },
      ])
      spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'buildCli').mockResolvedValue(shellResult())
      spyOn(io, 'mintOidcToken').mockResolvedValue('fake-oidc-token\n')
      spyOn(io, 'publishCli').mockResolvedValue(shellResult())
      spyOn(io, 'verifyCli').mockResolvedValue(shellResult())
      spyOn(io, 'promoteCli').mockResolvedValue(shellResult())
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
      spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/agent-facets%400.4.0\n',
      )
      spyOn(io, 'slackNotify').mockResolvedValue(undefined)
    }

    test('runs the full build → publish → verify → promote pipeline', async () => {
      process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
      setupCliReleasePath()

      const buildSpy = spyOn(io, 'buildCli').mockResolvedValue(shellResult())
      const publishSpy = spyOn(io, 'publishCli').mockResolvedValue(shellResult())
      const verifySpy = spyOn(io, 'verifyCli').mockResolvedValue(shellResult())
      const promoteSpy = spyOn(io, 'promoteCli').mockResolvedValue(shellResult())

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(buildSpy).toHaveBeenCalledTimes(1)
      expect(publishSpy).toHaveBeenCalledTimes(1)
      expect(verifySpy).toHaveBeenCalledTimes(1)
      expect(promoteSpy).toHaveBeenCalledTimes(1)
    })

    test('does not call npmPublish (uses publishCli instead)', async () => {
      process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
      setupCliReleasePath()

      const npmPublishSpy = spyOn(io, 'npmPublish').mockResolvedValue(shellResult())

      const { release } = await import('./ci-release')
      await release()

      expect(npmPublishSpy).not.toHaveBeenCalled()
    })

    test('mints OIDC token before publish', async () => {
      process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
      setupCliReleasePath()

      const mintSpy = spyOn(io, 'mintOidcToken').mockResolvedValue('oidc-token\n')

      const { release } = await import('./ci-release')
      await release()

      expect(mintSpy).toHaveBeenCalledTimes(1)
      expect(process.env.NPM_ID_TOKEN).toBe('oidc-token')
    })

    test('creates GitHub Release after promote', async () => {
      process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
      setupCliReleasePath()

      const releaseSpy = spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/agent-facets%400.4.0\n',
      )

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(releaseSpy).toHaveBeenCalledTimes(1)
      const [releaseTag, title] = releaseSpy.mock.calls[0] ?? []
      expect(releaseTag).toBe('agent-facets@0.4.0')
      expect(title).toBe('agent-facets@0.4.0')
    })

    test('sends Slack notification after release', async () => {
      process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
      setupCliReleasePath()

      const slackSpy = spyOn(io, 'slackNotify').mockResolvedValue(undefined)

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
      expect(slackSpy).toHaveBeenCalledTimes(1)
      const [channel] = slackSpy.mock.calls[0] ?? []
      expect(channel).toBe(SLACK_CHANNELS.auto_cli_deploys)
    })

    test('continues even if GitHub Release creation fails', async () => {
      process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
      setupCliReleasePath()
      spyOn(io, 'readFile').mockRejectedValue(new Error('CHANGELOG.md not found'))

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
    })

    test('continues even if Slack notification fails', async () => {
      process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
      setupCliReleasePath()
      spyOn(io, 'slackNotify').mockRejectedValue(new Error('Slack unavailable'))

      const { release } = await import('./ci-release')
      const code = await release()

      expect(code).toBe(0)
    })
  })
})
