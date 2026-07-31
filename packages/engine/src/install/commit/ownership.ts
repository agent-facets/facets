import type { AssetType, Scope } from '@agent-facets/common'
import {
  adapterKey,
  type MaterializedAsset,
  materializedNameOf,
  SKILL_PRIMARY_FILE,
  skillRootPath,
} from '@agent-facets/protocol'
import type { ProjectReceiptState } from '../receipt.ts'

/**
 * The global ownership index: what this machine has materialized, keyed by
 * the EFFECTIVE adapter identity rather than by facet.
 *
 * Keying by adapter identity is what makes the apply phase safe once names
 * can move between facets. Per-facet bookkeeping cannot answer the two
 * questions that matter:
 *
 *   - "Is this file still wanted by *anyone*?" — a name given up by one facet
 *     and claimed by another must not be deleted after being written.
 *   - "Which owned files may a replacement remove?" — two facets may have
 *     claimed one identity historically (duplicate receipt claims), and the
 *     replacement has to account for every path either of them owned.
 *
 * Both are properties of the identity, not of a facet, so the index is built
 * once over the complete previous set before anything is written or deleted.
 */

/** One effective identity this machine previously materialized. */
export interface PreviousOwnership {
  scope: Scope
  type: AssetType
  /** The name the asset was written under — what an adapter can address. */
  effectiveName: string
  /**
   * Skill-root-relative companion paths this identity owns, unioned across
   * every historical claim on it. Empty for non-skill assets.
   *
   * Already stripped to bundle-relative form, each claim using its OWN
   * authored name: an aliased skill's recorded paths are authored
   * (`skills/<authored>/...`) while its bundle lives under the effective
   * name, so stripping cannot be deferred to a single shared prefix.
   */
  ownedCompanionPaths: readonly string[]
  /** Every facet that claimed this identity. Sorted; usually one. */
  facets: readonly string[]
}

/**
 * Strip a recorded owned path to the bundle-relative form the adapter
 * contract uses, dropping the primary and anything not under the authored
 * skill root.
 *
 * A path outside the authored root cannot be addressed relative to the
 * bundle, so it is dropped rather than passed through: handing it to an
 * adapter would resolve it under the *effective* root at a path this system
 * never wrote, turning a bookkeeping inconsistency into a stray delete.
 */
function bundleRelativeCompanions(authoredName: string, ownedPaths: readonly string[]): string[] {
  const root = skillRootPath(authoredName)
  const primary = `${root}${SKILL_PRIMARY_FILE}`
  const companions: string[] = []
  for (const path of ownedPaths) {
    if (path === primary) continue
    if (!path.startsWith(root)) continue
    companions.push(path.slice(root.length))
  }
  return companions
}

/** Fold one claim into the index, unioning companion paths on collision. */
function addClaim(
  index: Map<string, PreviousOwnership>,
  facet: string,
  claim: { scope: Scope; type: AssetType; authoredName: string; effectiveName: string; ownedPaths: readonly string[] },
): void {
  const key = adapterKey(claim.scope, claim.type, claim.effectiveName)
  const companions = claim.type === 'skill' ? bundleRelativeCompanions(claim.authoredName, claim.ownedPaths) : []
  const existing = index.get(key)
  if (existing === undefined) {
    index.set(key, {
      scope: claim.scope,
      type: claim.type,
      effectiveName: claim.effectiveName,
      ownedCompanionPaths: companions,
      facets: [facet],
    })
    return
  }
  // Duplicate historical claim. Union the owned paths so a replacement write
  // accounts for every path either claimant left behind, and record both
  // facets so a delete is still reported against something meaningful.
  const merged = new Set([...existing.ownedCompanionPaths, ...companions])
  index.set(key, {
    ...existing,
    ownedCompanionPaths: [...merged].sort(),
    facets: existing.facets.includes(facet) ? existing.facets : [...existing.facets, facet].sort(),
  })
}

/**
 * Build the global previous-ownership index.
 *
 * Takes the receipt STATE rather than a receipt, so "no usable account" and
 * "an account that happens to be empty" cannot be confused at the call site.
 * The loaded record is the ONLY authority: it records what this machine
 * actually wrote, survives a `git pull` that rewrites the lockfile, and is the
 * only source that works offline. Nothing else may enter this index, because
 * everything in it is a licence to delete — the lockfile is shared,
 * version-controlled state describing what *should* be on disk on some
 * machine, and treating it as evidence about THIS one means deleting files a
 * teammate's commit merely mentioned.
 *
 * An identity absent here is UNTRACKED, not unowned-and-therefore-stale. It is
 * left alone unless the desired set asks for it; reconciling it to the desired
 * state — writing it, or proving it already matches — is what creates
 * ownership. See `run-install`'s apply ordering.
 */
export function buildPreviousOwnership(state: ProjectReceiptState): Map<string, PreviousOwnership> {
  const index = new Map<string, PreviousOwnership>()
  if (state.kind !== 'loaded') return index

  for (const [facet, entry] of Object.entries(state.receipt.facets)) {
    for (const asset of entry.assets) {
      addClaim(index, facet, {
        scope: asset.scope,
        type: asset.type,
        authoredName: asset.name,
        effectiveName: materializedNameOf(asset.name, asset.materialization),
        ownedPaths: asset.files,
      })
    }
  }

  return index
}

/**
 * The identities to delete: previously owned per the receipt, claimed by
 * nothing in the desired set.
 *
 * An identity claimed by ANY desired asset is retained even when the facet
 * that used to own it is gone — that is the ownership-transfer case, where
 * deleting would destroy content another facet is about to write (or has
 * already written).
 *
 * Deterministically ordered by adapter key so a rollback replays in a stable
 * sequence and verbose output is reviewable.
 */
export function obsoleteOwnership(
  previous: ReadonlyMap<string, PreviousOwnership>,
  desired: readonly MaterializedAsset[],
): PreviousOwnership[] {
  const claimed = new Set(desired.map((asset) => asset.adapterKey))
  const obsolete: { key: string; ownership: PreviousOwnership }[] = []
  for (const [key, ownership] of previous) {
    if (claimed.has(key)) continue
    obsolete.push({ key, ownership })
  }
  obsolete.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return obsolete.map((entry) => entry.ownership)
}

/**
 * The owned companion paths a desired asset's write may remove — the union of
 * whatever previously occupied the SAME effective identity.
 *
 * Looked up by adapter key rather than by facet so an identity taken over
 * from another facet still cleans up that facet's leftovers instead of
 * stranding them beside the new content.
 */
export function ownedCompanionPathsFor(
  previous: ReadonlyMap<string, PreviousOwnership>,
  asset: MaterializedAsset,
): readonly string[] {
  return previous.get(asset.adapterKey)?.ownedCompanionPaths ?? []
}
