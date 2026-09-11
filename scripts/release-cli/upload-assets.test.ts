import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { io } from '../lib/io'
import { shellResult, silenceIO } from '../lib/test-helpers'
import { releaseAssetsDir } from './targets'
import { expectedReleaseAssetNames, uploadCliAssets } from './upload-assets'

const assetsDir = releaseAssetsDir(resolve(import.meta.dir, '..', '..', 'packages', 'cli'))

async function writeAssets(names = expectedReleaseAssetNames()) {
  await mkdir(assetsDir, { recursive: true })
  for (const name of names) await writeFile(resolve(assetsDir, name), name)
}

describe('upload-assets.ts', () => {
  beforeEach(() => {
    silenceIO()
  })

  afterEach(async () => {
    mock.restore()
    delete process.env.CIRCLE_TAG
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    await rm(assetsDir, { recursive: true, force: true })
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

    const code = await uploadCliAssets()

    expect(code).toBe(0)
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

    const code = await uploadCliAssets()

    expect(code).toBe(1)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('fails when any expected asset is missing', async () => {
    process.env.CIRCLE_TAG = 'agent-facets@0.4.0'
    await writeAssets(expectedReleaseAssetNames().filter((name) => name !== 'checksums.txt'))
    const uploadSpy = spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())

    const code = await uploadCliAssets()

    expect(code).toBe(1)
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  test('rejects non-CLI release tags', async () => {
    process.env.CIRCLE_TAG = '@agent-facets/protocol@1.0.0'
    await writeAssets()
    const uploadSpy = spyOn(io.gh, 'releaseUpload').mockResolvedValue(shellResult())

    const code = await uploadCliAssets()

    expect(code).toBe(1)
    expect(uploadSpy).not.toHaveBeenCalled()
  })
})
