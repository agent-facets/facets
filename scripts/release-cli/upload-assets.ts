#!/usr/bin/env bun

/** Upload packaged CLI release assets to the GitHub Release. */
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mintGithubTokens } from '../lib/ci'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import { io } from '../lib/io'
import { parseTag } from '../lib/tags'
import { allTargets, releaseArchiveName, releaseAssetsDir, releaseAssetTargets } from './targets'

export type UploadCliAssetsResult =
  | { ok: true; tag: string; count: number }
  | { ok: false; code: 'missing-tag' }
  | { ok: false; code: 'invalid-tag'; tag: string }
  | { ok: false; code: 'wrong-package'; name: string }
  | { ok: false; code: 'missing-assets-dir'; assetsDir: string }
  | { ok: false; code: 'missing-assets'; assetsDir: string; missing: string[] }
  | { ok: false; code: 'github-upload-failed' }

/** Returns the complete GitHub Release asset set produced by package-assets.ts. */
export function expectedReleaseAssetNames(): string[] {
  return [...releaseAssetTargets(allTargets).map(releaseArchiveName), 'checksums.txt'].sort()
}

export async function uploadCliAssets(): Promise<UploadCliAssetsResult> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) {
    return { ok: false, code: 'missing-tag' }
  }

  const parsed = parseTag(tag)
  if (!parsed) {
    return { ok: false, code: 'invalid-tag', tag }
  }
  if (parsed.name !== CLI_PACKAGE_NAME) {
    return { ok: false, code: 'wrong-package', name: parsed.name }
  }

  const assetsDir = releaseAssetsDir(resolve(import.meta.dir, '..', '..', 'packages', 'cli'))
  const expected = expectedReleaseAssetNames()
  let actual: Set<string>
  try {
    actual = new Set(await readdir(assetsDir))
  } catch {
    return { ok: false, code: 'missing-assets-dir', assetsDir }
  }

  const missing = expected.filter((name) => !actual.has(name))
  if (missing.length > 0) {
    return { ok: false, code: 'missing-assets', assetsDir, missing }
  }

  await mintGithubTokens()
  const paths = expected.map((name) => resolve(assetsDir, name))
  try {
    await io.gh.releaseUpload(tag, paths)
  } catch {
    return { ok: false, code: 'github-upload-failed' }
  }
  return { ok: true, tag, count: paths.length }
}

export function renderUploadCliAssetsResult(result: UploadCliAssetsResult): number {
  if (result.ok) {
    io.console.log(`Uploaded ${result.count} release asset(s) to ${result.tag}.`)
    return 0
  }

  switch (result.code) {
    case 'missing-tag':
      io.console.error('CIRCLE_TAG not set.')
      break
    case 'invalid-tag':
      io.console.error(`Could not parse tag: ${result.tag}`)
      break
    case 'wrong-package':
      io.console.error(`Expected CLI release tag for ${CLI_PACKAGE_NAME}, got ${result.name}`)
      break
    case 'missing-assets-dir':
      io.console.error(`Release assets directory not found: ${result.assetsDir}`)
      break
    case 'missing-assets':
      io.console.error(`Missing release assets in ${result.assetsDir}: ${result.missing.join(', ')}`)
      break
    case 'github-upload-failed':
      io.console.error('Failed to upload release assets to GitHub.')
      break
  }
  return 1
}

if (import.meta.main) {
  const code = renderUploadCliAssetsResult(await uploadCliAssets())
  process.exit(code)
}
