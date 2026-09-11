#!/usr/bin/env bun

/** Upload packaged CLI release assets to the GitHub Release. */
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mintGithubTokens } from '../lib/ci'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import { io } from '../lib/io'
import { parseTag } from '../lib/tags'
import { allTargets, releaseArchiveName, releaseAssetsDir, releaseAssetTargets } from './targets'

export function expectedReleaseAssetNames(): string[] {
  return [...releaseAssetTargets(allTargets).map(releaseArchiveName), 'checksums.txt'].sort()
}

export async function uploadCliAssets(): Promise<number> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) {
    io.console.error('CIRCLE_TAG not set.')
    return 1
  }

  const parsed = parseTag(tag)
  if (!parsed) {
    io.console.error(`Could not parse tag: ${tag}`)
    return 1
  }
  if (parsed.name !== CLI_PACKAGE_NAME) {
    io.console.error(`Expected CLI release tag for ${CLI_PACKAGE_NAME}, got ${parsed.name}`)
    return 1
  }

  const assetsDir = releaseAssetsDir(resolve(import.meta.dir, '..', '..', 'packages', 'cli'))
  const expected = expectedReleaseAssetNames()
  let actual: Set<string>
  try {
    actual = new Set(await readdir(assetsDir))
  } catch {
    io.console.error(`Release assets directory not found: ${assetsDir}`)
    return 1
  }

  const missing = expected.filter((name) => !actual.has(name))
  if (missing.length > 0) {
    io.console.error(`Missing release assets in ${assetsDir}: ${missing.join(', ')}`)
    return 1
  }

  await mintGithubTokens()
  const paths = expected.map((name) => resolve(assetsDir, name))
  await io.gh.releaseUpload(tag, paths)
  io.console.log(`Uploaded ${paths.length} release asset(s) to ${tag}.`)
  return 0
}

if (import.meta.main) {
  const code = await uploadCliAssets()
  process.exit(code)
}
