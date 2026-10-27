import { createHash } from 'node:crypto'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import { parseTag } from '../lib/tags'
import { renderHomebrewFormula } from './homebrew-formula'
import { allTargets, releaseArchiveName, releaseAssetTargets } from './targets'

export interface HomebrewReleaseInput {
  tag: string
  release: {
    tagName: string
    isDraft: boolean
    isPrerelease: boolean
    isImmutable: boolean
    assets: Array<{ name: string; bytes: Uint8Array }>
  }
  /** Attestation identity returned by the read-only provenance verifier. */
  provenance: { tag: string; sourceRef: string; workflow: string } | null
}

export type ValidateHomebrewReleaseResult =
  | { ok: true; version: string; formula: string }
  | { ok: false; code: 'invalid-tag'; tag: string }
  | { ok: false; code: 'wrong-package'; name: string }
  | { ok: false; code: 'release-state-invalid' }
  | { ok: false; code: 'release-tag-mismatch'; tag: string; releaseTag: string }
  | { ok: false; code: 'provenance-unverified' }
  | { ok: false; code: 'release-assets-invalid' }
  | { ok: false; code: 'checksums-invalid' }
  | { ok: false; code: 'invalid-version'; version: string }

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseChecksums(bytes: Uint8Array, expectedNames: Set<string>): Map<string, string> | undefined {
  const listed = new Map<string, string>()
  const text = new TextDecoder().decode(bytes).trim()
  if (text === '') return undefined

  for (const line of text.split('\n')) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line)
    if (!match?.[1] || !match[2] || !expectedNames.has(match[2]) || listed.has(match[2])) return undefined
    listed.set(match[2], match[1])
  }
  return listed.size === expectedNames.size ? listed : undefined
}

/**
 * Fail-closed validation of already-read GitHub Release assets. This function
 * makes no network, GitHub, or filesystem calls; its caller owns read-only
 * release loading and provenance verification.
 */
export function validateHomebrewRelease(input: HomebrewReleaseInput): ValidateHomebrewReleaseResult {
  const parsed = parseTag(input.tag)
  if (!parsed) return { ok: false, code: 'invalid-tag', tag: input.tag }
  if (parsed.name !== CLI_PACKAGE_NAME) return { ok: false, code: 'wrong-package', name: parsed.name }
  if (
    input.release.tagName !== input.tag ||
    input.release.isDraft ||
    input.release.isPrerelease ||
    !input.release.isImmutable
  ) {
    return input.release.tagName === input.tag
      ? { ok: false, code: 'release-state-invalid' }
      : { ok: false, code: 'release-tag-mismatch', tag: input.tag, releaseTag: input.release.tagName }
  }
  if (
    input.provenance?.tag !== input.tag ||
    input.provenance.sourceRef !== `refs/tags/${input.tag}` ||
    input.provenance.workflow !== 'agent-facets/facets/.github/workflows/release-cli-assets.yml'
  ) {
    return { ok: false, code: 'provenance-unverified' }
  }

  const expectedNames = new Set(releaseAssetTargets(allTargets).map(releaseArchiveName))
  const assets = new Map(input.release.assets.map((asset) => [asset.name, asset.bytes]))
  if (
    assets.size !== input.release.assets.length ||
    !assets.has('checksums.txt') ||
    assets.size !== expectedNames.size + 1
  ) {
    return { ok: false, code: 'release-assets-invalid' }
  }
  if ([...expectedNames].some((name) => !assets.has(name))) return { ok: false, code: 'release-assets-invalid' }

  const checksums = parseChecksums(assets.get('checksums.txt') as Uint8Array, expectedNames)
  if (!checksums || [...expectedNames].some((name) => checksums.get(name) !== sha256(assets.get(name) as Uint8Array))) {
    return { ok: false, code: 'checksums-invalid' }
  }

  const rendered = renderHomebrewFormula(
    parsed.version,
    new TextDecoder().decode(assets.get('checksums.txt') as Uint8Array),
  )
  if (rendered.ok) return { ok: true, version: parsed.version, formula: rendered.content }
  return rendered.code === 'invalid-version'
    ? { ok: false, code: 'invalid-version', version: rendered.version }
    : { ok: false, code: 'checksums-invalid' }
}
