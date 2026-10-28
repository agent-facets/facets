import { createHash } from 'node:crypto'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import { parseTag } from '../lib/tags'
import { allTargets, releaseArchiveName, releaseAssetTargets } from './targets'

const WORKFLOW = 'agent-facets/facets/.github/workflows/release-cli-assets.yml'
const verified = Symbol('verified-homebrew-provenance')

export interface HomebrewProvenanceAsset {
  name: string
  bytes: Uint8Array
  path: string
}

export interface VerifiedHomebrewProvenance {
  readonly [verified]: true
  readonly tag: string
  readonly sourceRef: string
  readonly workflow: typeof WORKFLOW
  readonly archiveDigests: Readonly<Record<string, string>>
}

export type VerifyHomebrewProvenanceResult =
  | { ok: true; provenance: VerifiedHomebrewProvenance }
  | { ok: false; code: 'invalid-tag'; tag: string }
  | { ok: false; code: 'wrong-package'; name: string }
  | { ok: false; code: 'release-assets-invalid' }
  | { ok: false; code: 'provenance-unverified'; asset: string }

export interface VerifyHomebrewProvenanceOptions {
  tag: string
  assets: HomebrewProvenanceAsset[]
  /** Runs `gh attestation verify` for the exact downloaded archive path. */
  verify: (path: string, sourceRef: string, workflow: string) => Promise<boolean>
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Verifies every expected archive attestation before minting the opaque
 * provenance capability accepted by `validateHomebrewRelease`.
 */
export async function verifyHomebrewReleaseProvenance(
  options: VerifyHomebrewProvenanceOptions,
): Promise<VerifyHomebrewProvenanceResult> {
  const parsed = parseTag(options.tag)
  if (!parsed) return { ok: false, code: 'invalid-tag', tag: options.tag }
  if (parsed.name !== CLI_PACKAGE_NAME) return { ok: false, code: 'wrong-package', name: parsed.name }

  const expected = releaseAssetTargets(allTargets).map(releaseArchiveName)
  const assets = new Map(options.assets.map((asset) => [asset.name, asset]))
  if (assets.size !== options.assets.length || expected.some((name) => !assets.has(name))) {
    return { ok: false, code: 'release-assets-invalid' }
  }

  const sourceRef = `refs/tags/${options.tag}`
  const archiveDigests: Record<string, string> = {}
  for (const name of expected) {
    const asset = assets.get(name)
    if (!asset) return { ok: false, code: 'release-assets-invalid' }
    if (!(await options.verify(asset.path, sourceRef, WORKFLOW))) {
      return { ok: false, code: 'provenance-unverified', asset: name }
    }
    archiveDigests[name] = digest(asset.bytes)
  }

  return {
    ok: true,
    provenance: { [verified]: true, tag: options.tag, sourceRef, workflow: WORKFLOW, archiveDigests },
  }
}

/** Returns whether a value is a verifier-issued provenance capability. */
export function isVerifiedHomebrewProvenance(value: unknown): value is VerifiedHomebrewProvenance {
  return typeof value === 'object' && value !== null && verified in value && value[verified] === true
}
