import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { io } from '../lib/io'
import { shellPromise, shellResult, silenceIO } from '../lib/test-helpers'
import { expectedReleaseAssetNames, uploadCliAssets } from './upload-assets'

let assetsDir: string

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

async function writeAssets(names = expectedReleaseAssetNames()) {
  await mkdir(assetsDir, { recursive: true })
  const archives = names.filter((name) => name !== 'checksums.txt')
  for (const name of archives) await Bun.write(resolve(assetsDir, name), name)
  if (names.includes('checksums.txt')) {
    await Bun.write(
      `${assetsDir}/checksums.txt`,
      `${archives
        .map((name) => `${digest(name)}  ${name}`)
        .sort()
        .join('\n')}\n`,
    )
  }
}

function release(assets: Array<{ name: string; size: number; digest?: string }> = [], isDraft = true) {
  return shellResult(
    JSON.stringify({
      tagName: 'agent-facets@0.4.0',
      isDraft,
      isImmutable: !isDraft,
      url: 'https://example.test/release',
      assets,
    }),
  )
}

function expectedRemoteAssets() {
  return expectedReleaseAssetNames().map((name) => ({
    name,
    size:
      name === 'checksums.txt'
        ? expectedReleaseAssetNames()
            .filter((asset) => asset !== 'checksums.txt')
            .map((asset) => `${digest(asset)}  ${asset}`)
            .sort()
            .join('\n').length + 1
        : name.length,
    digest: `sha256:${
      name === 'checksums.txt'
        ? digest(
            `${expectedReleaseAssetNames()
              .filter((asset) => asset !== 'checksums.txt')
              .map((asset) => `${digest(asset)}  ${asset}`)
              .sort()
              .join('\n')}\n`,
          )
        : digest(name)
    }`,
  }))
}

describe('upload-assets.ts', () => {
  beforeEach(async () => {
    assetsDir = await mkdtemp(resolve(tmpdir(), 'facet-release-assets-'))
    silenceIO()
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    spyOn(io.shell, 'mintGitHubAppToken').mockResolvedValue('token')
    spyOn(io.shell, 'readFile').mockResolvedValue('## 0.4.0\n\n- Test release')
  })
  afterEach(async () => {
    mock.restore()
    await rm(assetsDir, { recursive: true, force: true })
    delete process.env.CIRCLE_TAG
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
  })

  test('rejects missing local assets before GitHub authentication', async () => {
    const auth = spyOn(io.shell, 'mintGitHubAppToken')
    expect(await uploadCliAssets({ assetsDir })).toMatchObject({ ok: false, code: 'missing-assets' })
    expect(auth).not.toHaveBeenCalled()
  })

  test('rejects a local archive whose checksum does not match', async () => {
    await writeAssets()
    const firstAsset = expectedReleaseAssetNames()[0]
    if (!firstAsset) expect.unreachable()
    await Bun.write(resolve(assetsDir, firstAsset), 'tampered')
    expect(await uploadCliAssets({ assetsDir })).toEqual({ ok: false, code: 'invalid-checksums' })
  })

  test('creates a draft, uploads, verifies, publishes, then notifies', async () => {
    await writeAssets()
    const events: string[] = []
    spyOn(io.gh, 'releaseView')
      .mockResolvedValueOnce(shellResult('', 1))
      .mockResolvedValueOnce(release())
      .mockResolvedValueOnce(release(expectedRemoteAssets()))
      .mockResolvedValueOnce(release(expectedRemoteAssets(), false))
    spyOn(io.gh, 'releaseCreateDraft').mockImplementation(async () => {
      events.push('draft')
      return ''
    })
    spyOn(io.gh, 'releaseUpload').mockImplementation(() => {
      events.push('upload')
      return shellPromise()
    })
    spyOn(io.gh, 'releasePublish').mockImplementation(async () => {
      events.push('publish')
      return ''
    })

    expect(await uploadCliAssets({ assetsDir })).toEqual({
      ok: true,
      tag: 'agent-facets@0.4.0',
      count: 9,
      published: true,
    })
    expect(events).toEqual(['draft', 'upload', 'publish'])
  })

  test('repairs a partial draft and never creates a second release', async () => {
    await writeAssets()
    const draft = spyOn(io.gh, 'releaseCreateDraft')
    spyOn(io.gh, 'releaseView')
      .mockResolvedValueOnce(release())
      .mockResolvedValueOnce(release(expectedRemoteAssets()))
      .mockResolvedValueOnce(release(expectedRemoteAssets(), false))
    spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())
    spyOn(io.gh, 'releasePublish').mockResolvedValue('')

    expect((await uploadCliAssets({ assetsDir })).ok).toBe(true)
    expect(draft).not.toHaveBeenCalled()
  })

  test('leaves an immutable incomplete release untouched', async () => {
    await writeAssets()
    spyOn(io.gh, 'releaseView').mockResolvedValue(release([], false))
    const upload = spyOn(io.gh, 'releaseUpload')

    expect(await uploadCliAssets({ assetsDir })).toEqual({
      ok: false,
      code: 'published-release-incomplete',
      tag: 'agent-facets@0.4.0',
    })
    expect(upload).not.toHaveBeenCalled()
  })

  test('accepts an already-published complete matching release without mutation', async () => {
    await writeAssets()
    spyOn(io.gh, 'releaseView').mockResolvedValue(release(expectedRemoteAssets(), false))
    const upload = spyOn(io.gh, 'releaseUpload')

    expect(await uploadCliAssets({ assetsDir })).toEqual({
      ok: true,
      tag: 'agent-facets@0.4.0',
      count: 9,
      published: false,
    })
    expect(upload).not.toHaveBeenCalled()
  })

  test('does not publish when uploaded bytes do not match the remote digest', async () => {
    await writeAssets()
    spyOn(io.gh, 'releaseView').mockResolvedValueOnce(release()).mockResolvedValueOnce(release([]))
    spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())
    const publish = spyOn(io.gh, 'releasePublish')

    expect(await uploadCliAssets({ assetsDir })).toEqual({
      ok: false,
      code: 'remote-assets-mismatch',
      tag: 'agent-facets@0.4.0',
    })
    expect(publish).not.toHaveBeenCalled()
  })

  test('recognizes a complete release after a previously lost publication response', async () => {
    await writeAssets()
    spyOn(io.gh, 'releaseView').mockResolvedValue(release(expectedRemoteAssets(), false))
    const publish = spyOn(io.gh, 'releasePublish')

    expect(await uploadCliAssets({ assetsDir })).toMatchObject({ ok: true, published: false })
    expect(publish).not.toHaveBeenCalled()
  })
})
