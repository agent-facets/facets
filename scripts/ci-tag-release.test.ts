import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from './lib/ci-io'
import { shellResult, silenceIO } from './lib/test-helpers'

describe('ci-tag-release', () => {
  beforeEach(() => {
    silenceIO()
    spyOn(io, 'mintGitHubToken').mockResolvedValue('fake-gh-token')
    spyOn(io, 'ghAuthSetupGit').mockResolvedValue(shellResult())
  })

  afterEach(() => {
    mock.restore()
    delete process.env.CIRCLE_SHA1
  })

  describe('tagRelease', () => {
    test('returns 1 when CIRCLE_SHA1 is not set', async () => {
      delete process.env.CIRCLE_SHA1

      const { tagRelease } = await import('./ci-tag-release')
      const code = await tagRelease()

      expect(code).toBe(1)
    })

    test('exits early when commit has no associated PRs', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io, 'ghGetPrForCommit').mockResolvedValue([])
      const fetchSpy = spyOn(io, 'gitFetchSha').mockResolvedValue(shellResult())

      const { tagRelease } = await import('./ci-tag-release')
      const code = await tagRelease()

      expect(code).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('exits early when commit is not a version PR merge', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io, 'ghGetPrForCommit').mockResolvedValue([
        { number: 99, headRefName: 'feature/something', headRefOid: 'def456' },
      ])
      const fetchSpy = spyOn(io, 'gitFetchSha').mockResolvedValue(shellResult())

      const { tagRelease } = await import('./ci-tag-release')
      const code = await tagRelease()

      expect(code).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('does not create tags when all versions are already published', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io, 'ghGetPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io, 'gitFetchSha').mockResolvedValue(shellResult())
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      const tagSpy = spyOn(io, 'gitTagAt').mockResolvedValue(shellResult())

      const { tagRelease } = await import('./ci-tag-release')
      const code = await tagRelease()

      expect(code).toBe(0)
      expect(tagSpy).not.toHaveBeenCalled()
    })

    test('creates and pushes tags for unpublished packages on the original PR commit', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io, 'ghGetPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io, 'gitFetchSha').mockResolvedValue(shellResult())
      spyOn(io, 'gitConfig').mockResolvedValue(shellResult())
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
        { name: '@agent-facets/brand', version: '0.2.0', dir: 'packages/brand' },
        { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli', private: true },
      ])
      spyOn(io, 'npmViewVersion').mockImplementation(async (pkg: string) => {
        if (pkg === '@agent-facets/core') return '1.0.0' // bumped
        if (pkg === '@agent-facets/brand') return '0.2.0' // unchanged
        if (pkg === 'agent-facets') return null // private, never published
        return null
      })
      const tagSpy = spyOn(io, 'gitTagAt').mockResolvedValue(shellResult())
      const pushSpy = spyOn(io, 'gitPushAllTags').mockResolvedValue(shellResult())

      const { tagRelease } = await import('./ci-tag-release')
      const code = await tagRelease()

      expect(code).toBe(0)
      expect(tagSpy).toHaveBeenCalledWith('@agent-facets/core@1.1.0', 'original-sha')
      expect(tagSpy).toHaveBeenCalledWith('agent-facets@0.4.0', 'original-sha')
      expect(tagSpy).not.toHaveBeenCalledWith('@agent-facets/brand@0.2.0', 'original-sha')
      expect(pushSpy).toHaveBeenCalledWith('origin')
    })

    test('fetches the original branch commit SHA', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io, 'ghGetPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'the-real-sha' },
      ])
      const fetchSpy = spyOn(io, 'gitFetchSha').mockResolvedValue(shellResult())
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')

      const { tagRelease } = await import('./ci-tag-release')
      await tagRelease()

      expect(fetchSpy).toHaveBeenCalledWith('origin', 'the-real-sha')
    })

    test('configures git identity before creating tags', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io, 'ghGetPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io, 'gitFetchSha').mockResolvedValue(shellResult())
      spyOn(io, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
      ])
      spyOn(io, 'npmViewVersion').mockResolvedValue('1.0.0')
      spyOn(io, 'gitTagAt').mockResolvedValue(shellResult())
      spyOn(io, 'gitPushAllTags').mockResolvedValue(shellResult())
      const configSpy = spyOn(io, 'gitConfig').mockResolvedValue(shellResult())

      const { tagRelease } = await import('./ci-tag-release')
      await tagRelease()

      expect(configSpy).toHaveBeenCalledWith('user.name', 'the-faceter[bot]')
      expect(configSpy).toHaveBeenCalledWith('user.email', '272408671+the-faceter[bot]@users.noreply.github.com')
    })
  })
})
