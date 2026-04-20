import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as ci from '../lib/ci'
import { CIRCLECI_PROJECT_SLUG, CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID } from '../lib/constants'
import { io } from '../lib/io'
import { shellResult, silenceIO } from '../lib/test-helpers'

describe('tag.ts', () => {
  beforeEach(() => {
    silenceIO()
    spyOn(io.shell, 'mintGitHubAppToken').mockResolvedValue('fake-gh-token')
    spyOn(io.shell, 'sleep').mockResolvedValue(undefined)
    spyOn(io.gh, 'authSetupGit').mockResolvedValue(shellResult())
  })

  afterEach(() => {
    mock.restore()
    delete process.env.CIRCLE_SHA1
  })

  describe('tagRelease', async () => {
    const { tagRelease } = await import('./tag')

    test('returns 1 when CIRCLE_SHA1 is not set', async () => {
      delete process.env.CIRCLE_SHA1

      const code = await tagRelease()

      expect(code).toBe(1)
    })

    test('polls and exits when commit has no associated PRs after full window', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      // GitHub's commit→PR index never catches up — endpoint keeps returning [].
      const prSpy = spyOn(io.gh, 'getPrForCommit').mockResolvedValue([])
      const fetchSpy = spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())

      const code = await tagRelease()

      expect(code).toBe(0)
      // Polled the full window (30 attempts) before giving up.
      expect(prSpy).toHaveBeenCalledTimes(30)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('polls getPrForCommit until the PR appears, then proceeds with tagging', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      // Simulate GitHub's commit→PR index catching up on the 4th poll.
      const prSpy = spyOn(io.gh, 'getPrForCommit')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' }])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
      ])
      spyOn(io.npm, 'viewVersion').mockResolvedValue('1.0.0')
      const tagSpy = spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(prSpy).toHaveBeenCalledTimes(4)
      // Proceeded with tagging — did not bail out on the empty responses.
      expect(tagSpy).toHaveBeenCalledWith('@agent-facets/core@1.1.0', 'original-sha')
    })

    test('exits early when commit is not a version PR merge', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 99, headRefName: 'feature/something', headRefOid: 'def456' },
      ])
      const fetchSpy = spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('does not create tags when all versions are already published', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])
      spyOn(io.npm, 'viewVersion').mockResolvedValue('1.0.0')
      const tagSpy = spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      const triggerSpy = spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(tagSpy).not.toHaveBeenCalled()
      expect(triggerSpy).not.toHaveBeenCalled()
    })

    test('creates and pushes tags for unpublished packages on the original PR commit', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
        { name: '@agent-facets/brand', version: '0.2.0', dir: 'packages/brand' },
        { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli', private: true },
      ])
      spyOn(io.npm, 'viewVersion').mockImplementation(async (pkg: string) => {
        if (pkg === '@agent-facets/core') return '1.0.0' // bumped
        if (pkg === '@agent-facets/brand') return '0.2.0' // unchanged
        if (pkg === 'agent-facets') return null // private, never published
        return null
      })
      const tagSpy = spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      const pushSpy = spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(tagSpy).toHaveBeenCalledWith('@agent-facets/core@1.1.0', 'original-sha')
      expect(tagSpy).toHaveBeenCalledWith('agent-facets@0.4.0', 'original-sha')
      expect(tagSpy).not.toHaveBeenCalledWith('@agent-facets/brand@0.2.0', 'original-sha')
      expect(pushSpy).toHaveBeenCalledWith('origin')
    })

    test('creates tag when only the private CLI package has a version bump', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
        { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli', private: true },
      ])
      spyOn(io.npm, 'viewVersion').mockImplementation(async (pkg: string) => {
        if (pkg === '@agent-facets/core') return '1.0.0' // unchanged
        if (pkg === 'agent-facets') return '0.3.0' // bumped
        return null
      })
      const tagSpy = spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      const pushSpy = spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(tagSpy).toHaveBeenCalledWith('agent-facets@0.4.0', 'original-sha')
      expect(tagSpy).not.toHaveBeenCalledWith('@agent-facets/core@1.0.0', 'original-sha')
      expect(pushSpy).toHaveBeenCalledWith('origin')
    })

    test('skips packages with releaseMode:"skip" when tagging', async () => {
      // @agent-facets/common is workspace-only — marked agentFacets.release:"skip"
      // in its package.json. It must not be tagged even when it has a version
      // bump, because no release pipeline would do anything useful with the tag
      // and the tag would collide on subsequent release cycles.
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
        { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli', private: true },
        { name: '@agent-facets/common', version: '0.1.4', dir: 'packages/common', private: true, releaseMode: 'skip' },
      ])
      spyOn(io.npm, 'viewVersion').mockImplementation(async (pkg: string) => {
        if (pkg === '@agent-facets/core') return '1.0.0' // bumped
        if (pkg === 'agent-facets') return '0.3.0' // bumped
        return null // common is never published
      })
      const tagSpy = spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      const triggerSpy = spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(tagSpy).toHaveBeenCalledWith('@agent-facets/core@1.1.0', 'original-sha')
      expect(tagSpy).toHaveBeenCalledWith('agent-facets@0.4.0', 'original-sha')
      expect(tagSpy).not.toHaveBeenCalledWith('@agent-facets/common@0.1.4', 'original-sha')
      // Only the two non-skipped packages should trigger pipelines.
      expect(triggerSpy).toHaveBeenCalledTimes(2)
    })

    test('returns early when only releaseMode:"skip" packages have bumps', async () => {
      // If every bumped package is release-skipped, there's nothing to tag.
      // Without this handling, hasUnpublishedVersions would return true
      // forever (npm view always returns null for skipped packages) and
      // tag.ts would attempt tagging on every main-pipeline run.
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
        { name: '@agent-facets/common', version: '0.1.4', dir: 'packages/common', private: true, releaseMode: 'skip' },
      ])
      spyOn(io.npm, 'viewVersion').mockImplementation(async (pkg: string) => {
        if (pkg === '@agent-facets/core') return '1.0.0' // unchanged
        return null // common is never published
      })
      const tagSpy = spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      const pushSpy = spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      const triggerSpy = spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(tagSpy).not.toHaveBeenCalled()
      expect(pushSpy).not.toHaveBeenCalled()
      expect(triggerSpy).not.toHaveBeenCalled()
    })

    test('fetches the original branch commit SHA', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'the-real-sha' },
      ])
      const fetchSpy = spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.0.0', dir: 'packages/core' },
      ])
      spyOn(io.npm, 'viewVersion').mockResolvedValue('1.0.0')

      await tagRelease()

      expect(fetchSpy).toHaveBeenCalledWith('origin', 'the-real-sha')
    })

    test('configures git identity before creating tags', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
      ])
      spyOn(io.npm, 'viewVersion').mockResolvedValue('1.0.0')
      spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      const configSpy = spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      await tagRelease()

      expect(configSpy).toHaveBeenCalledWith('user.name', 'the-faceter[bot]')
      expect(configSpy).toHaveBeenCalledWith('user.email', '272408671+the-faceter[bot]@users.noreply.github.com')
    })

    test('triggers CircleCI pipeline for each pushed tag', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
        { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli', private: true },
      ])
      spyOn(io.npm, 'viewVersion').mockImplementation(async (pkg: string) => {
        if (pkg === '@agent-facets/core') return '1.0.0' // bumped
        if (pkg === 'agent-facets') return '0.3.0' // bumped
        return null
      })
      spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      const triggerSpy = spyOn(io.circleci, 'triggerPipelineForTag').mockResolvedValue({ id: 'p1', number: 1 })

      const code = await tagRelease()

      expect(code).toBe(0)
      expect(triggerSpy).toHaveBeenCalledTimes(2)
      expect(triggerSpy).toHaveBeenCalledWith(
        CIRCLECI_PROJECT_SLUG,
        CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID,
        '@agent-facets/core@1.1.0',
      )
      expect(triggerSpy).toHaveBeenCalledWith(
        CIRCLECI_PROJECT_SLUG,
        CIRCLECI_RELEASE_PIPELINE_DEFINITION_ID,
        'agent-facets@0.4.0',
      )
    })

    test('propagates trigger failures so CI marks the job as failed', async () => {
      process.env.CIRCLE_SHA1 = 'abc123'
      spyOn(io.gh, 'getPrForCommit').mockResolvedValue([
        { number: 52, headRefName: 'changeset-release/main', headRefOid: 'original-sha' },
      ])
      spyOn(io.git, 'fetchSha').mockResolvedValue(shellResult())
      spyOn(io.git, 'config').mockResolvedValue(shellResult())
      spyOn(ci, 'loadWorkspacePackages').mockResolvedValue([
        { name: '@agent-facets/core', version: '1.1.0', dir: 'packages/core' },
      ])
      spyOn(io.npm, 'viewVersion').mockResolvedValue('1.0.0')
      spyOn(io.git, 'tagAt').mockResolvedValue(shellResult())
      spyOn(io.git, 'pushAllTags').mockResolvedValue(shellResult())
      spyOn(io.circleci, 'triggerPipelineForTag').mockRejectedValue(
        new Error('CircleCI pipeline trigger failed for tag @agent-facets/core@1.1.0: 401 Unauthorized'),
      )

      await expect(tagRelease()).rejects.toThrow('CircleCI pipeline trigger failed')
    })
  })
})
