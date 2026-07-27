import type { SupportedLockfileFacet } from '@agent-facets/protocol'
import type { RunInstallFailure } from '../types.ts'
import type { VerifiedAssetPlan } from '../verified-asset-plan.ts'

/**
 * Pre-materialization reconciliation (design D10, task 9.3).
 *
 * Before any adapter write, when a facet is being REPRODUCED — the freshly
 * resolved artifact has the same facet-level integrity the lockfile pins —
 * the previously-locked `0.2` entry MUST agree with the freshly-derived
 * verified asset plan. A disagreement means the locked records no longer
 * describe the identical artifact they pin: a hand-edited lockfile, a
 * coordinated cache/lockfile rewrite, or a per-file integrity problem the
 * version-selected chain integrity did not express. Every mismatch is a
 * path- or identity-specific structured failure so the CLI can name the
 * exact divergence, and because reconciliation runs before materialization
 * the project, lockfile, receipt, and adapter state stay untouched.
 *
 * Scope (what this check does and does not cover):
 *
 *   - **Reproduction only.** Reconciliation runs only when
 *     `current.integrity === previous.integrity` — the same artifact is
 *     being reproduced. A legitimate change (new version, edited local
 *     facet, removed asset) resolves to a DIFFERENT integrity, so the locked
 *     entry is expected to differ and reconciliation is skipped; the fresh
 *     plan simply becomes the new truth.
 *   - The adapter-compatibility preflight and the archive-version /
 *     facet-integrity checks already run ahead of this point (the resolve
 *     chain's registry three-check and git one-check prove the content
 *     reproduces the locked facet integrity). This function adds the
 *     per-asset and per-file agreement the chain integrity does not express.
 *   - It only runs when BOTH a `previous` locked entry and a freshly-derived
 *     `plan` are present. A fresh add has no prior entry to reconcile
 *     against. A frozen reproduction derives no plan (the entry is inherited
 *     verbatim, possibly legacy) and is gated by the frozen drift preflight
 *     instead.
 *   - A legacy (`1`) `previous` entry carries identity-only assets (no
 *     per-file records). Asset-identity agreement is still checked; per-file
 *     agreement is vacuous because the legacy entry pins no file hashes.
 *     This is the migration case, and it is intentionally permissive at the
 *     file level — the plan's recomputed records become the new `0.2` truth.
 */
export function reconcileLockedAgainstPlan(
  facet: string,
  previous: SupportedLockfileFacet | undefined,
  currentIntegrity: string,
  plan: VerifiedAssetPlan,
): RunInstallFailure | undefined {
  if (previous === undefined) return undefined

  // Reproduction gate: only reconcile when the SAME artifact is being
  // reproduced. A different integrity is a legitimate update/edit, where the
  // locked entry is expected to change and the fresh plan is the new truth.
  if (currentIntegrity !== previous.integrity) return undefined

  // Migration gate: a legacy (`1`) entry carries identity-only assets under
  // the previous system's conventions (e.g. a different default scope). Its
  // asset identities and file records are NOT authoritative against the
  // current plan — a normal install migrates it to `0.2`, and the fresh plan
  // becomes the new truth. Reconciliation therefore only asserts agreement
  // between a `0.2` locked entry and the plan.
  const anyLockedFiles = previous.assets.some((a) => filesOf(a) !== undefined)
  if (!anyLockedFiles) return undefined

  // Asset-identity agreement: the locked identity set vs the plan's.
  const lockedIdentities = new Set(previous.assets.map(identityKey))
  const plannedIdentities = new Set(plan.assets.map(identityKey))
  const missing = [...lockedIdentities].filter((k) => !plannedIdentities.has(k)).sort()
  const unexpected = [...plannedIdentities].filter((k) => !lockedIdentities.has(k)).sort()
  if (missing.length > 0 || unexpected.length > 0) {
    return { code: 'RECONCILE_ASSET_IDENTITY', facet, missing, unexpected }
  }

  // Per-asset owned-path sets and per-file integrity. Only a `0.2` locked
  // asset carries `files`; a legacy identity-only asset has none, so per-file
  // reconciliation is skipped for it (migration).
  const plannedByIdentity = new Map(plan.assets.map((a) => [identityKey(a), a]))
  for (const lockedAsset of previous.assets) {
    const lockedFiles = filesOf(lockedAsset)
    if (lockedFiles === undefined) continue // legacy identity-only entry

    const planned = plannedByIdentity.get(identityKey(lockedAsset))
    // Identity agreement above guarantees a planned counterpart exists.
    if (planned === undefined) continue

    const assetLabel = `${lockedAsset.type}:${lockedAsset.name}`
    const plannedByPath = new Map(planned.files.map((f) => [f.path, f.integrity]))
    const lockedPaths = new Set(lockedFiles.map((f) => f.path))
    const plannedPaths = new Set(planned.files.map((f) => f.path))

    const missingPaths = [...lockedPaths].filter((p) => !plannedPaths.has(p)).sort()
    const unexpectedPaths = [...plannedPaths].filter((p) => !lockedPaths.has(p)).sort()
    if (missingPaths.length > 0 || unexpectedPaths.length > 0) {
      return {
        code: 'RECONCILE_OWNED_PATH_SET',
        facet,
        asset: assetLabel,
        missing: missingPaths,
        unexpected: unexpectedPaths,
      }
    }

    for (const record of lockedFiles) {
      const recomputed = plannedByPath.get(record.path)
      // Path-set agreement above guarantees a recomputed hash exists.
      if (recomputed === undefined) continue
      if (record.integrity !== recomputed) {
        return {
          code: 'RECONCILE_PER_FILE_INTEGRITY',
          facet,
          asset: assetLabel,
          path: record.path,
          expected: record.integrity,
          actual: recomputed,
        }
      }
    }
  }

  return undefined
}

function identityKey(asset: { scope: string; type: string; name: string }): string {
  return `${asset.scope}:${asset.type}:${asset.name}`
}

/**
 * Extract the per-file records from a locked asset. A `0.2` asset carries a
 * `files` array; a legacy (`1`) identity-only asset does not. The permissive
 * `LockfileAssetEntry` type does not statically expose `files`, so this reads
 * it structurally and narrows the shape at the boundary.
 */
function filesOf(asset: unknown): ReadonlyArray<{ path: string; integrity: string }> | undefined {
  if (typeof asset !== 'object' || asset === null || !('files' in asset)) return undefined
  const files = (asset as { files: unknown }).files
  if (!Array.isArray(files)) return undefined
  return files as ReadonlyArray<{ path: string; integrity: string }>
}
