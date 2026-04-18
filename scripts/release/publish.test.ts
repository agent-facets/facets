import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as announce from '../lib/announce'
import * as ci from '../lib/ci'
import { SLACK_CHANNELS } from '../lib/constants'
import { io } from '../lib/io'
import * as npm from '../lib/npm'
import { parseTag } from '../lib/tags'
import { SAMPLE_CHANGELOG, shellResult, silenceIO } from '../lib/test-helpers'

describe('publish.ts', () => {
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
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core', private: false },
      ])
      spyOn(io, 'mintGitHubAppToken').mockResolvedValue('fake-gh-token')
      spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      spyOn(io, 'mintCircleOidcToken').mockResolvedValue('fake-oidc-token\n')
      spyOn(io, 'npmPublish').mockResolvedValue(shellResult())
      spyOn(announce, 'slackNotify').mockResolvedValue(undefined)
      spyOn(io, 'readFile').mockResolvedValue(SAMPLE_CHANGELOG)
      spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/%40agent-facets%2Fcore%401.1.0\n',
      )
      // Default to "version is new on npm" so existing tests keep their
      // behavior. Idempotency-specific tests override this.
      spyOn(npm, 'versionExists').mockResolvedValue(false)
    }

    test('returns 1 when CIRCLE_TAG is not set', async () => {
      delete process.env.CIRCLE_TAG

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(1)
    })

    test('returns 1 for unparseable tag', async () => {
      process.env.CIRCLE_TAG = 'not-a-tag'

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(1)
    })

    test('returns 1 when package not found in workspace', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/nonexistent@1.0.0'
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(1)
    })

    test('returns 1 when version mismatches', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@9.9.9'
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(1)
    })

    test('publishes non-private package to npm', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()

      const publishSpy = spyOn(io, 'npmPublish').mockResolvedValue(shellResult())

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(0)
      expect(publishSpy).toHaveBeenCalledWith('packages/core')
    })

    test('skips private packages without publishing', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/platform-opencode@0.1.0'
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/platform-opencode', version: '0.1.0', dir: 'packages/platform-opencode', private: true },
      ])
      const publishSpy = spyOn(io, 'npmPublish').mockResolvedValue(shellResult())

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(0)
      expect(publishSpy).not.toHaveBeenCalled()
    })

    test('mints OIDC token before npm publish', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()

      const mintSpy = spyOn(io, 'mintCircleOidcToken').mockResolvedValue('oidc-token\n')

      const { release } = await import('./publish')
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

      const { release } = await import('./publish')
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

      const slackSpy = spyOn(announce, 'slackNotify').mockResolvedValue(undefined)

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(0)
      expect(slackSpy).toHaveBeenCalledTimes(1)
      const [channel] = slackSpy.mock.calls[0] ?? []
      expect(channel).toBe(SLACK_CHANNELS.auto_cli_deploys)
    })

    test('sets both GH_TOKEN and GITHUB_TOKEN', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      spyOn(io, 'mintGitHubAppToken').mockResolvedValue('release-token')

      const { release } = await import('./publish')
      await release()

      expect(process.env.GH_TOKEN).toBe('release-token')
      expect(process.env.GITHUB_TOKEN).toBe('release-token')
    })

    test('continues even if GitHub Release creation fails', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      spyOn(io, 'readFile').mockRejectedValue(new Error('CHANGELOG.md not found'))

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(0)
    })

    test('continues even if Slack notification fails', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      spyOn(announce, 'slackNotify').mockRejectedValue(new Error('Slack unavailable'))

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(0)
    })

    test('skips npm publish when version is already on registry', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      // Override: pretend the version is already published. This happens when
      // a tag is re-pushed to recover from a post-publish failure.
      spyOn(npm, 'versionExists').mockResolvedValue(true)

      const publishSpy = spyOn(io, 'npmPublish').mockResolvedValue(shellResult())
      const buildSpy = spyOn(io, 'turboBuild').mockResolvedValue(shellResult())
      const oidcSpy = spyOn(io, 'mintCircleOidcToken').mockResolvedValue('oidc\n')

      const { release } = await import('./publish')
      const code = await release()

      expect(code).toBe(0)
      expect(publishSpy).not.toHaveBeenCalled()
      // Don't waste CI minutes rebuilding or minting tokens we don't need.
      expect(buildSpy).not.toHaveBeenCalled()
      expect(oidcSpy).not.toHaveBeenCalled()
    })

    test('still runs GitHub Release + Slack even when npm publish is skipped', async () => {
      process.env.CIRCLE_TAG = '@agent-facets/core@1.1.0'
      setupPublishPath()
      spyOn(npm, 'versionExists').mockResolvedValue(true)

      const releaseSpy = spyOn(io, 'ghReleaseCreate').mockResolvedValue(
        'https://github.com/agent-facets/facets/releases/tag/core\n',
      )
      const slackSpy = spyOn(announce, 'slackNotify').mockResolvedValue(undefined)

      const { release } = await import('./publish')
      await release()

      // Re-pushing a tag after a failure should re-attempt the announce steps,
      // since that's the usual reason for re-running: finalize failed after
      // publish succeeded.
      expect(releaseSpy).toHaveBeenCalledTimes(1)
      expect(slackSpy).toHaveBeenCalledTimes(1)
    })
  })
})
