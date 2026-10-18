import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { io } from '../lib/io'
import { shellResult, silenceIO } from '../lib/test-helpers'
import { expectedReleaseAssetNames, renderUploadCliAssetsResult, uploadCliAssets } from './upload-assets'

let assetsDir: string
let originalEnv: Pick<NodeJS.ProcessEnv, 'CIRCLE_TAG' | 'GH_TOKEN' | 'GITHUB_TOKEN'>

async function writeAssets(names = expectedReleaseAssetNames()) {
  await mkdir(assetsDir, { recursive: true })
  for (const name of names) await Bun.write(resolve(assetsDir, name), name)
}

describe('upload-assets.ts', () => {
  beforeEach(() => {
    silenceIO()
    originalEnv = {
      CIRCLE_TAG: process.env.CIRCLE_TAG,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    }
  })

  afterEach(async () => {
    mock.restore()
    process.env.CIRCLE_TAG = originalEnv.CIRCLE_TAG
    process.env.GH_TOKEN = originalEnv.GH_TOKEN
    process.env.GITHUB_TOKEN = originalEnv.GITHUB_TOKEN
    if (originalEnv.CIRCLE_TAG === undefined) delete process.env.CIRCLE_TAG
    if (originalEnv.GH_TOKEN === undefined) delete process.env.GH_TOKEN
    if (originalEnv.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN
    if (assetsDir !== undefined) await rm(assetsDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    assetsDir = await mkdtemp(resolve(tmpdir(), 'facet-release-assets-'))
  })

  test('expected assets include all archives and checksums', () => {
    expect(expectedReleaseAssetNames()).toEqual([
      'checksums.txt',
      'facet-darwin-arm64.tar.gz',
      'facet-darwin-x64.tar.gz',
      'facet-linux-arm64-musl.tar.gz',
      'facet-linux-arm64.tar.gz',
      'facet-linux-x64-musl.tar.gz',
      'facet-linux-x64.tar.gz',
      'facet-windows-arm64.zip',
      'facet-windows-x64.zip',
    ])
  })

  test('uploads all expected assets with --clobber through the GitHub I/O layer', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    await writeAssets()
    spyOn(io.shell, 'mintGitHubAppToken').mockResolvedValue('fake-token')
    const uploadSpy = spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())

    const result = await uploadCliAssets({ assetsDir })

    expect(result).toEqual({ ok: true, tag: 'agent-facets@0.4.0', count: expectedReleaseAssetNames().length })
    expect(renderUploadCliAssetsResult(result)).toBe(0)
    expect(process.env.GH_TOKEN).toBe('fake-token')
    expect(process.env.GITHUB_TOKEN).toBe('fake-token')
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    const [tag, paths] = uploadSpy.mock.calls[0] ?? []
    expect(tag).toBe('agent-facets@0.4.0')
    expect(paths).toEqual(expectedReleaseAssetNames().map((name) => resolve(assetsDir, name)))
  })

  test('fails when the assets directory is missing', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    const uploadSpy = spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())

    await rm(assetsDir, { recursive: true })
    const result = await uploadCliAssets({ assetsDir })

    expect(result).toEqual({ ok: false, code: 'missing-assets-dir', assetsDir })
    expect(renderUploadCliAssetsResult(result)).toBe(1)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('fails when any expected asset is missing', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    await writeAssets(expectedReleaseAssetNames().filter((name) => name !== 'checksums.txt'))
    const uploadSpy = spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())

    const result = await uploadCliAssets({ assetsDir })

    expect(result).toEqual({ ok: false, code: 'missing-assets', assetsDir, missing: ['checksums.txt'] })
    expect(renderUploadCliAssetsResult(result)).toBe(1)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('rejects non-CLI release tags', async () => {
    process.env.CIRCLE_TAG = '@agent-facets/protocol@1.0.0'
    await writeAssets()
    const uploadSpy = spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())

    const result = await uploadCliAssets({ assetsDir })

    expect(result).toEqual({ ok: false, code: 'wrong-package', name: '@agent-facets/protocol' })
    expect(renderUploadCliAssetsResult(result)).toBe(1)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('returns a structured failure when GitHub upload fails', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    await writeAssets()
    spyOn(io.shell, 'mintGitHubAppToken').mockResolvedValue('fake-token')
    spyOn(io.gh, 'releaseUpload').mockRejectedValue(new Error('upload failed'))

    const result = await uploadCliAssets({ assetsDir })

    expect(result).toEqual({ ok: false, code: 'github-upload-failed' })
    expect(renderUploadCliAssetsResult(result)).toBe(1)
  })

  test('returns a structured failure when GitHub authentication fails', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    await writeAssets()
    spyOn(io.shell, 'mintGitHubAppToken').mockRejectedValue(new Error('authentication failed'))
    const uploadSpy = spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())

    const result = await uploadCliAssets({ assetsDir })

    expect(result).toEqual({ ok: false, code: 'github-auth-failed' })
    expect(renderUploadCliAssetsResult(result)).toBe(1)
    expect(uploadSpy).not.toHaveBeenCalled()
  })
})
