import type { AssetType, Scope } from '@agent-facets/common'
import type {
  CurrentLockfileFacet,
  FacetContribution,
  FacetMaterializationOverrides,
  MaterializedAsset,
  StaleOverride,
  SupportedLockfile,
  SupportedLockfileFacet,
} from '@agent-facets/protocol'
import {
  collisionKey,
  compareCodeUnits,
  lockedDispositionOf,
  planMaterialization,
  sameDisposition,
} from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { buildPreviousOwnership, type PreviousOwnership } from '../commit/ownership.ts'
import { detectLockfileDrift } from '../detect-lockfile-drift.ts'
import { ownEntry, ownRecord } from '../own-entry.ts'
import {
  materializedDispositionOf,
  ownedPathsForLockedAsset,
  type Receipt,
  type ReceiptAsset,
  type ReceiptFacetEntry,
  receiptEntryForLockedFacet,
} from '../receipt.ts'
import type { FacetOutcome, LockfileDriftEntry } from '../types.ts'

/**
 * Removal without resolution.
 *
 * Removing a facet is a question about state this machine already has: which
 * effective identities does the receipt still own, and what should the
 * lockfile say once one entry is gone. Routing it through the normal install
 * pipeline answered a different question — it re-resolved every SURVIVING
 * facet — so removing one facet failed outright when an unrelated survivor
 * was uncached and its registry unreachable. The published contract says
 * removal needs neither cache nor network; that only held for the facet being
 * removed.
 *
 * This module answers the real question locally. Every surviving entry is
 * carried forward verbatim — source, version, integrity, file records, and
 * unrecognized fields — and refined to the current schema by attaching the
 * disposition it already records. Refinement is lossless, so it applies to
 * every supported lockfile version rather than only the migrating one.
 *
 * The lockfile alone cannot authorize that, because it is SHARED state: a
 * `git pull` can change what a survivor's assets are supposed to be called
 * without touching the files this machine wrote. So refinement also witnesses
 * every survivor against the machine-local receipt, and returns the receipt
 * records it checked — the commit then carries those forward instead of
 * re-deriving them from lockfile claims it never applied. A survivor the
 * receipt does not mention at all is a bootstrap gap rather than a
 * disagreement, and the lockfile answers for it as it always has.
 *
 * When the local state cannot answer the question — a survivor was never
 * locked, its locked entry no longer satisfies the manifest, the locked set
 * still collides, an identity a survivor keeps was also claimed by something
 * this removal drops, the receipt disagrees with a survivor's locked entry,
 * or the manifest declares intent the lockfile does not yet record — this
 * returns `not-applicable` and the caller runs the ordinary pipeline. That is
 * deliberate: those cases genuinely require resolution, and failing instead
 * would break removals that work today for reasons unrelated to the facet
 * being removed.
 */

/**
 * How this machine's receipt disagrees with a survivor's locked entry.
 *
 * Each arm names something the ordinary pipeline would have to WRITE to make
 * true, which is exactly why a removal cannot honor it.
 */
export type SurvivorReceiptDisagreement =
  /** The receipt records a different resolved version than the lockfile. */
  | { kind: 'version'; recorded: string; locked: string }
  /** The lockfile says this asset is materialized; the receipt never saw it. */
  | { kind: 'asset-unrecorded'; scope: Scope; assetType: AssetType; authoredName: string }
  /** Both know the asset, but disagree about the name it was written under. */
  | { kind: 'disposition'; scope: Scope; assetType: AssetType; authoredName: string }
  /** Both know the asset, but disagree about which files it owns. */
  | { kind: 'owned-files'; scope: Scope; assetType: AssetType; authoredName: string }

/** Why a removal could not be answered from local state alone. */
export type RefineNotApplicable =
  /** The project has no lockfile, so nothing has been resolved yet. */
  | { code: 'no-lockfile' }
  /** A surviving facet has no locked entry to carry forward. */
  | { code: 'survivor-not-locked'; facet: string }
  /** A surviving facet's locked entry no longer matches its manifest source or specifier. */
  | { code: 'survivor-drifted'; facets: ReadonlyArray<LockfileDriftEntry> }
  /** The surviving locked set does not plan cleanly (collision or invalid alias). */
  | { code: 'locked-set-unplannable' }
  /**
   * An effective identity a survivor keeps was also claimed by something this
   * removal drops. The bytes at that identity may be the dropped claimant's,
   * and nothing on this path writes the survivor's content over them.
   */
  | {
      code: 'retained-identity-contested'
      scope: Scope
      assetType: AssetType
      effectiveName: string
      survivor: string
      contestedBy: readonly string[]
    }
  /**
   * The machine-local receipt does not witness what a survivor's locked entry
   * describes. Believing the lockfile would rewrite this machine's ownership
   * record to describe files it does not have.
   */
  | { code: 'survivor-receipt-disagrees'; facet: string; disagreement: SurvivorReceiptDisagreement }
  /**
   * A survivor declares materialization intent its locked entry does not
   * record. Honoring it means writing assets, which removal does not do.
   */
  | { code: 'survivor-intent-unrecorded'; facet: string; assetType: AssetType; authoredName: string }

/** Everything the commit needs, derived without a single fetch. */
export interface RefinedRemoval {
  /** Current-schema entries for every surviving facet. */
  facetEntries: Record<string, CurrentLockfileFacet>
  /** The effective set that survives, for ownership diffing. */
  materialized: readonly MaterializedAsset[]
  /**
   * What this machine had materialized before the removal, keyed by effective
   * adapter identity. Returned rather than recomputed by the caller so the
   * index the gates were checked against IS the one the delete pass diffs.
   */
  previousOwnership: ReadonlyMap<string, PreviousOwnership>
  /**
   * The survivors' receipt records, each witnessed against its locked entry.
   * This is the machine's own account of what is on disk, not a projection of
   * the lockfile, so committing it cannot invent an identity.
   */
  receiptFacets: Record<string, ReceiptFacetEntry>
  /** The survivors' persisted intent, unchanged. */
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>
  /** Survivor overrides naming assets the locked content no longer has. */
  staleOverrides: readonly StaleOverride[]
  /** Survivors, reported as untouched. */
  outcomes: readonly FacetOutcome[]
}

export type RefineRemovalResult =
  | { kind: 'refined'; refinement: RefinedRemoval }
  | { kind: 'not-applicable'; reason: RefineNotApplicable }

export interface RefineRemovalArgs {
  /** The post-removal desired set. */
  desiredFacets: Readonly<Record<string, NormalizedFacetEntry>>
  previousLockfile: SupportedLockfile
  lockfileExisted: boolean
  /** This machine's record of what it materialized. The authority on disk state. */
  receipt: Receipt
}

export function refineRemoval(args: RefineRemovalArgs): RefineRemovalResult {
  const { desiredFacets, previousLockfile, lockfileExisted, receipt } = args

  if (!lockfileExisted) return { kind: 'not-applicable', reason: { code: 'no-lockfile' } }

  // Collect the surviving entries up front. Doing it here rather than during
  // the rebuild means every later step holds a real entry, so there is no
  // "this cannot be undefined" branch downstream.
  const survivors: Array<{ name: string; entry: SupportedLockfileFacet }> = []
  for (const name of Object.keys(desiredFacets).sort(compareCodeUnits)) {
    const entry = ownEntry(previousLockfile.facets, name)
    if (entry === undefined) return { kind: 'not-applicable', reason: { code: 'survivor-not-locked', facet: name } }
    survivors.push({ name, entry })
  }

  // Source and specifier agreement. Orphaned entries — locked but no longer
  // declared — are exactly what this operation drops, so they are not drift
  // here. `no-entry` was already handled above.
  const drift = detectLockfileDrift(desiredFacets, previousLockfile, lockfileExisted).filter(
    (entry) => entry.reason !== 'orphaned' && entry.reason !== 'no-entry',
  )
  if (drift.length > 0) return { kind: 'not-applicable', reason: { code: 'survivor-drifted', facets: drift } }

  // Plan the SURVIVORS' locked assets: an alias or collision already recorded
  // among the facets that stay must still be reported rather than carried
  // forward silently. A claim by a facet this removal DROPS cannot appear
  // here — the desired set no longer contains it — so it is checked below,
  // against what this machine actually materialized.
  const contributions: FacetContribution[] = survivors.map(({ name, entry }) => ({
    facet: name,
    assets: entry.assets.map((asset) => ({ scope: asset.scope, type: asset.type, name: asset.name })),
    overrides: ownEntry(desiredFacets, name)?.overrides,
  }))
  const planned = planMaterialization(contributions)
  if (!planned.ok) return { kind: 'not-applicable', reason: { code: 'locked-set-unplannable' } }

  // Declared intent must already BE the recorded intent. A survivor whose
  // manifest asks for an alias the lockfile does not record needs its assets
  // moved on disk, and a removal never writes an asset — so that operation
  // belongs on the ordinary path.
  const lockedByFacet = new Map(survivors.map(({ name, entry }) => [name, entry]))
  for (const asset of planned.plan.assets) {
    const locked = lockedByFacet
      .get(asset.facet)
      ?.assets.find(
        (candidate) =>
          candidate.scope === asset.scope && candidate.type === asset.type && candidate.name === asset.authoredName,
      )
    if (locked === undefined) continue
    if (sameDisposition(lockedDispositionOf(locked), asset.disposition)) continue
    return {
      kind: 'not-applicable',
      reason: {
        code: 'survivor-intent-unrecorded',
        facet: asset.facet,
        assetType: asset.type,
        authoredName: asset.authoredName,
      },
    }
  }

  // An identity a survivor KEEPS must have been that survivor's alone. When
  // something this removal drops also claimed it, whichever claimant wrote
  // last owns the bytes currently on disk — and this path has no write pass to
  // put the survivor's content back. Compared on the portable collision key,
  // so a claim differing only by case or Unicode normalization (one file on a
  // case-insensitive volume) is caught rather than mistaken for a spare
  // identity that can simply be deleted.
  const previousOwnership = buildPreviousOwnership(receipt, previousLockfile)
  const contested = contestedRetainedIdentity(previousOwnership, planned.plan.materialized)
  if (contested !== null) return { kind: 'not-applicable', reason: contested }

  // Rebuild each survivor structurally: identity, provenance, and integrity
  // are copied, never recomputed, because recomputing them is precisely the
  // fetch this path exists to avoid.
  // Null-prototype: this path never resolves, so the facet-name validation
  // that rejects a `__proto__` key on the ordinary path never runs here. A
  // survivor dropped by the prototype setter would lose its lockfile entry
  // while its assets stayed on disk, unclaimed and undeletable.
  const facetEntries: Record<string, CurrentLockfileFacet> = ownRecord()
  const receiptFacets: Record<string, ReceiptFacetEntry> = ownRecord()
  const overrides: Record<string, FacetMaterializationOverrides> = ownRecord()
  const outcomes: FacetOutcome[] = []
  for (const { name, entry } of survivors) {
    // The receipt is the authority on disk state, so it decides what this
    // machine keeps claiming. A facet it does not mention is a bootstrap gap —
    // the same one `buildPreviousOwnership` already falls back on — and the
    // locked entry answers for it. A facet it DOES mention must agree, or the
    // rewrite would replace an accurate record with a claim about files this
    // machine never wrote.
    const recorded = ownEntry(receipt.facets, name)
    if (recorded === undefined) {
      receiptFacets[name] = receiptEntryForLockedFacet(entry)
    } else {
      const witnessed = witnessSurvivor(recorded, entry)
      if (!witnessed.ok) {
        return {
          kind: 'not-applicable',
          reason: { code: 'survivor-receipt-disagrees', facet: name, disagreement: witnessed.disagreement },
        }
      }
      receiptFacets[name] = witnessed.entry
    }

    facetEntries[name] = {
      source: entry.source,
      version: entry.version,
      integrity: entry.integrity,
      assets: entry.assets.map((asset) => ({
        scope: asset.scope,
        type: asset.type,
        name: asset.name,
        materialization: lockedDispositionOf(asset),
        files: asset.files,
      })),
    }
    const declared = ownEntry(desiredFacets, name)?.overrides
    if (declared !== undefined) overrides[name] = declared
    outcomes.push({ kind: 'unchanged', name, version: entry.version })
  }

  return {
    kind: 'refined',
    refinement: {
      facetEntries,
      materialized: planned.plan.materialized,
      previousOwnership,
      receiptFacets,
      overrides,
      staleOverrides: planned.staleOverrides,
      outcomes,
    },
  }
}

/**
 * The first retained identity that something other than its retaining
 * survivor also claimed, or `null` when every retained identity was already
 * that survivor's own.
 *
 * Only identities a survivor KEEPS matter. An identity nothing keeps is
 * handled by the delete pass, so two dropped facets contending over one name
 * do not block a removal that is about to take that name off disk entirely.
 */
function contestedRetainedIdentity(
  previousOwnership: ReadonlyMap<string, PreviousOwnership>,
  materialized: readonly MaterializedAsset[],
): RefineNotApplicable | null {
  const retained = new Map<string, MaterializedAsset>()
  for (const asset of materialized) {
    retained.set(collisionKey(asset.scope, asset.type, asset.effectiveName), asset)
  }
  // Sorted so the reported claim is the same one on every machine.
  const ordered = [...previousOwnership.entries()].sort(([a], [b]) => compareCodeUnits(a, b))
  for (const [, ownership] of ordered) {
    const survivor = retained.get(collisionKey(ownership.scope, ownership.type, ownership.effectiveName))
    if (survivor === undefined) continue
    const contestedBy = ownership.facets.filter((facet) => facet !== survivor.facet)
    if (contestedBy.length === 0) continue
    return {
      code: 'retained-identity-contested',
      scope: ownership.scope,
      assetType: ownership.type,
      effectiveName: ownership.effectiveName,
      survivor: survivor.facet,
      contestedBy,
    }
  }
  return null
}

type WitnessedSurvivor =
  | { ok: true; entry: ReceiptFacetEntry }
  | { ok: false; disagreement: SurvivorReceiptDisagreement }

/**
 * Check a survivor's locked entry against what this machine recorded writing,
 * and return the receipt entry to carry forward.
 *
 * The returned entry is built from the RECEIPT's records, in locked-asset
 * order. Every materialized locked asset must have one, so a locked asset the
 * receipt never saw is a disagreement rather than a silent gap — while a
 * receipt asset the lockfile no longer lists is dropped, because the removal
 * is exactly what makes it obsolete and the delete pass still holds its claim.
 */
function witnessSurvivor(recorded: ReceiptFacetEntry, locked: SupportedLockfileFacet): WitnessedSurvivor {
  if (recorded.version !== locked.version) {
    return { ok: false, disagreement: { kind: 'version', recorded: recorded.version, locked: locked.version } }
  }
  const assets: ReceiptAsset[] = []
  for (const asset of locked.assets) {
    const disposition = materializedDispositionOf(asset)
    if (disposition === undefined) continue
    const identity = { scope: asset.scope, assetType: asset.type, authoredName: asset.name }
    const witnessed = recorded.assets.find(
      (candidate) => candidate.scope === asset.scope && candidate.type === asset.type && candidate.name === asset.name,
    )
    if (witnessed === undefined) return { ok: false, disagreement: { kind: 'asset-unrecorded', ...identity } }
    if (!sameDisposition(witnessed.materialization, disposition)) {
      return { ok: false, disagreement: { kind: 'disposition', ...identity } }
    }
    if (!sameOwnedPaths(witnessed.files, ownedPathsForLockedAsset(asset))) {
      return { ok: false, disagreement: { kind: 'owned-files', ...identity } }
    }
    assets.push(witnessed)
  }
  return { ok: true, entry: { version: recorded.version, assets } }
}

/** Set equality over owned paths. Order is not part of what either side means. */
function sameOwnedPaths(recorded: readonly string[], locked: readonly string[]): boolean {
  if (recorded.length !== locked.length) return false
  const left = [...recorded].sort(compareCodeUnits)
  const right = [...locked].sort(compareCodeUnits)
  return left.every((path, index) => path === right[index])
}
