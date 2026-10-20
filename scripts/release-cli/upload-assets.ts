#!/usr/bin/env bun

/** Deliver packaged CLI archives through a draft GitHub Release. */
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getChangelogEntry } from '@changesets/release-utils'
import { slackNotify } from '../lib/announce'
import { transformChangelogContent } from '../lib/changesets'
import { mintGithubTokens } from '../lib/ci'
import { CLI_PACKAGE_NAME, SLACK_CHANNELS } from '../lib/constants'
import { io } from '../lib/io'
import { parseTag } from '../lib/tags'
import { allTargets, releaseArchiveName, releaseAssetsDir, releaseAssetTargets } from './targets'

type ReleaseAsset = { name: string; size: number; digest?: string }
type Release = { tagName: string; isDraft: boolean; isImmutable: boolean; url: string; assets: ReleaseAsset[] }

export type UploadCliAssetsResult =
  | { ok: true; tag: string; count: number; published: boolean }
  | { ok: false; code: 'missing-tag' }
  | { ok: false; code: 'invalid-tag'; tag: string }
  | { ok: false; code: 'wrong-package'; name: string }
  | { ok: false; code: 'missing-assets-dir'; assetsDir: string }
  | { ok: false; code: 'missing-assets'; assetsDir: string; missing: string[] }
  | { ok: false; code: 'invalid-checksums' }
  | { ok: false; code: 'github-auth-failed' }
  | { ok: false; code: 'github-release-view-failed' }
  | { ok: false; code: 'github-draft-failed' }
  | { ok: false; code: 'published-release-incomplete'; tag: string }
  | { ok: false; code: 'github-upload-failed' }
  | { ok: false; code: 'remote-assets-mismatch'; tag: string }
  | { ok: false; code: 'github-publish-failed' }

export type UploadCliAssetsOptions = {
  /** Override for tests; production uses the packaged CLI asset directory. */
  assetsDir?: string
}

/** Returns the complete GitHub Release asset set produced by package-assets.ts. */
export function expectedReleaseAssetNames(): string[] {
  return [...releaseAssetTargets(allTargets).map(releaseArchiveName), 'checksums.txt'].sort()
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function localAssetDigests(
  assetsDir: string,
  expected: string[],
): Promise<Record<string, { size: number; digest: string }> | undefined> {
  const archives = expected.filter((name) => name !== 'checksums.txt')
  const checksums = await Bun.file(resolve(assetsDir, 'checksums.txt')).text()
  const listed = new Map<string, string>()
  for (const line of checksums.trim().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line)
    if (!match?.[1] || !match[2] || listed.has(match[2])) return undefined
    listed.set(match[2], match[1])
  }
  if (listed.size !== archives.length || archives.some((name) => !listed.has(name))) return undefined

  const digests: Record<string, { size: number; digest: string }> = {}
  for (const name of expected) {
    const bytes = await Bun.file(resolve(assetsDir, name)).bytes()
    const digest = sha256(bytes)
    if (name !== 'checksums.txt' && listed.get(name) !== digest) return undefined
    digests[name] = { size: bytes.byteLength, digest }
  }
  return digests
}

function parseRelease(stdout: Buffer): Release | undefined {
  try {
    const release = JSON.parse(stdout.toString()) as Release
    if (
      typeof release.tagName !== 'string' ||
      typeof release.isDraft !== 'boolean' ||
      typeof release.isImmutable !== 'boolean' ||
      typeof release.url !== 'string' ||
      !Array.isArray(release.assets)
    ) {
      return undefined
    }
    return release
  } catch {
    return undefined
  }
}

function remoteAssetsMatch(release: Release, expected: Record<string, { size: number; digest: string }>): boolean {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]))
  if (assets.size !== Object.keys(expected).length || release.assets.length !== assets.size) return false
  return Object.entries(expected).every(([name, local]) => {
    const remote = assets.get(name)
    return remote?.size === local.size && remote.digest === `sha256:${local.digest}`
  })
}

async function releaseNotes(version: string): Promise<string | undefined> {
  try {
    const changelog = await io.shell.readFile('packages/cli/CHANGELOG.md')
    return transformChangelogContent(getChangelogEntry(changelog, version).content)
  } catch {
    return undefined
  }
}

export async function uploadCliAssets(options: UploadCliAssetsOptions = {}): Promise<UploadCliAssetsResult> {
  const tag = process.env.CIRCLE_TAG
  if (!tag) return { ok: false, code: 'missing-tag' }

  const parsed = parseTag(tag)
  if (!parsed) return { ok: false, code: 'invalid-tag', tag }
  if (parsed.name !== CLI_PACKAGE_NAME) return { ok: false, code: 'wrong-package', name: parsed.name }

  const assetsDir = options.assetsDir ?? releaseAssetsDir(resolve(import.meta.dir, '..', '..', 'packages', 'cli'))
  const expected = expectedReleaseAssetNames()
  let actual: Set<string>
  try {
    actual = new Set(await readdir(assetsDir))
  } catch {
    return { ok: false, code: 'missing-assets-dir', assetsDir }
  }
  const missing = expected.filter((name) => !actual.has(name))
  if (missing.length > 0) return { ok: false, code: 'missing-assets', assetsDir, missing }

  const local = await localAssetDigests(assetsDir, expected)
  if (!local) return { ok: false, code: 'invalid-checksums' }

  try {
    await mintGithubTokens()
  } catch {
    return { ok: false, code: 'github-auth-failed' }
  }

  let viewed = await io.gh.releaseView(tag)
  let release = viewed.exitCode === 0 ? parseRelease(viewed.stdout) : undefined
  if (viewed.exitCode === 0 && !release) return { ok: false, code: 'github-release-view-failed' }

  if (release && release.tagName !== tag) return { ok: false, code: 'github-release-view-failed' }
  if (release && !release.isDraft) {
    if (remoteAssetsMatch(release, local)) return { ok: true, tag, count: expected.length, published: false }
    return { ok: false, code: 'published-release-incomplete', tag }
  }

  if (!release) {
    const notes = await releaseNotes(parsed.version)
    if (!notes) return { ok: false, code: 'github-draft-failed' }
    try {
      await io.gh.releaseCreateDraft(tag, tag, notes)
      viewed = await io.gh.releaseView(tag)
      release = viewed.exitCode === 0 ? parseRelease(viewed.stdout) : undefined
    } catch {
      return { ok: false, code: 'github-draft-failed' }
    }
    if (!release?.isDraft || release.tagName !== tag) return { ok: false, code: 'github-draft-failed' }
  }

  try {
    await io.gh.releaseUpload(
      tag,
      expected.map((name) => resolve(assetsDir, name)),
    )
  } catch {
    return { ok: false, code: 'github-upload-failed' }
  }

  viewed = await io.gh.releaseView(tag)
  release = viewed.exitCode === 0 ? parseRelease(viewed.stdout) : undefined
  if (!release?.isDraft || !remoteAssetsMatch(release, local)) {
    return { ok: false, code: 'remote-assets-mismatch', tag }
  }

  try {
    await io.gh.releasePublish(tag)
  } catch {
    return { ok: false, code: 'github-publish-failed' }
  }
  viewed = await io.gh.releaseView(tag)
  release = viewed.exitCode === 0 ? parseRelease(viewed.stdout) : undefined
  if (!release || release.isDraft || !remoteAssetsMatch(release, local)) {
    return { ok: false, code: 'github-publish-failed' }
  }
  try {
    await slackNotify(SLACK_CHANNELS.auto_cli_deploys, `🚀 Published: <${release.url}|${tag}>`)
  } catch {
    io.console.error(`GitHub Release ${tag} was published, but Slack notification failed.`)
  }
  return { ok: true, tag, count: expected.length, published: true }
}

export function renderUploadCliAssetsResult(result: UploadCliAssetsResult): number {
  if (result.ok) {
    io.console.log(
      result.published
        ? `Published ${result.tag} with ${result.count} verified release asset(s).`
        : `${result.tag} already has ${result.count} verified release asset(s).`,
    )
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
    case 'invalid-checksums':
      io.console.error('Release asset checksums are missing, malformed, or do not match local archives.')
      break
    case 'github-auth-failed':
      io.console.error('Failed to authenticate with GitHub for CLI release delivery.')
      break
    case 'github-release-view-failed':
      io.console.error('Failed to inspect the GitHub Release state.')
      break
    case 'github-draft-failed':
      io.console.error('Failed to create or validate the draft GitHub Release.')
      break
    case 'published-release-incomplete':
      io.console.error(
        `Published release ${result.tag} is immutable and does not match local assets. Publish a new version; do not mutate this release.`,
      )
      break
    case 'github-upload-failed':
      io.console.error('Failed to upload release assets; the draft was retained for retry.')
      break
    case 'remote-assets-mismatch':
      io.console.error(
        `Uploaded assets for ${result.tag} do not match local SHA-256 digests; the draft was retained for retry.`,
      )
      break
    case 'github-publish-failed':
      io.console.error('Failed to publish the verified draft GitHub Release.')
      break
  }
  return 1
}

if (import.meta.main) process.exit(renderUploadCliAssetsResult(await uploadCliAssets()))
