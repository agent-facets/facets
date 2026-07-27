import type { Adapter } from '@agent-facets/adapter'
import type { SupportedLockfile } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import type { InstallJournal } from '../journal.ts'
import { materialize } from '../materialize.ts'
import { materializeFailureToRunInstall } from '../materialize-failure.ts'
import { ownedPathsForLockedAsset, type Receipt } from '../receipt.ts'
import { removalManifest } from '../removal-manifest.ts'
import type { FacetOutcome, MaterializedAssetOwnership, OnLog, RunInstallFailure, StageEvent } from '../types.ts'

export interface DriftRemovalSuccess {
  /** One `removed` outcome per cleaned-up facet. */
  outcomes: FacetOutcome[]
  removedAssets: number
}

export type DriftRemovalResult = { ok: true; value: DriftRemovalSuccess } | { ok: false; failure: RunInstallFailure }

export interface DriftRemovalArgs {
  desiredFacets: Readonly<Record<string, NormalizedFacetEntry>>
  receipt: Receipt
  previousLockfile: SupportedLockfile
  adapters: ReadonlyArray<Adapter>
  journal: InstallJournal
  signal?: AbortSignal
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Receipt-driven drift removal: facets the receipt records as
 * materialized on this machine but the desired set no longer wants.
 *
 * The comparison is against the RECEIPT, never the on-disk lockfile —
 * that is what makes orphan-on-pull recoverable (a `git pull` can drop
 * a lockfile entry but cannot touch the machine-local receipt).
 * SupportedLockfile-only entries are also caught (the receipt was just
 * bootstrapped and doesn't have the entry yet). The asset set to
 * delete comes from the receipt (preferred) or the lockfile (fallback)
 * — offline, with no cache and no network.
 *
 * Like the install loop, this reports the first failure and never
 * unwinds; the caller owns journal rollback.
 */
export async function removeDriftedFacets(args: DriftRemovalArgs): Promise<DriftRemovalResult> {
  const { desiredFacets, receipt, previousLockfile, adapters, journal, signal, onStage, onLog } = args

  const unwantedFromReceipt = Object.keys(receipt.facets).filter((name) => desiredFacets[name] === undefined)
  const unwantedFromLockfile = Object.keys(previousLockfile.facets).filter(
    (name) => desiredFacets[name] === undefined && !receipt.facets[name],
  )
  const unwantedNames = [...new Set([...unwantedFromReceipt, ...unwantedFromLockfile])]

  const outcomes: FacetOutcome[] = []
  let removedAssets = 0

  for (const facetName of unwantedNames) {
    if (signal?.aborted) {
      return { ok: false, failure: { code: 'ABORTED' } }
    }

    const receiptEntry = receipt.facets[facetName]
    const lockfileEntry = previousLockfile.facets[facetName]
    // Ownership is normalized per source. The receipt already stores bare
    // owned paths — it is the authority for what this machine actually
    // materialized — and the lockfile is the fallback when no receipt entry
    // exists, with its per-file records reduced to paths.
    const oldAssets: MaterializedAssetOwnership[] =
      receiptEntry !== undefined
        ? receiptEntry.assets.map((asset) => ({
            scope: asset.scope,
            type: asset.type,
            name: asset.name,
            ownedPaths: asset.files,
          }))
        : (lockfileEntry?.assets ?? []).map((asset) => ({
            scope: asset.scope,
            type: asset.type,
            name: asset.name,
            ownedPaths: ownedPathsForLockedAsset(asset),
          }))
    const oldVersion = receiptEntry?.version ?? lockfileEntry?.version ?? '0.0.0'

    onStage({ kind: 'drift-removal', facet: facetName, oldVersion })
    const removalResult = await materialize({
      facetName,
      manifest: removalManifest(facetName),
      adapters: [...adapters],
      oldAssets,
      newAssets: [],
      journal,
      onLog,
      onStage,
    })
    if (!removalResult.ok) {
      return { ok: false, failure: materializeFailureToRunInstall(facetName, removalResult.failure) }
    }
    removedAssets += oldAssets.length * adapters.length
    outcomes.push({ kind: 'removed', name: facetName, oldVersion })
  }

  return { ok: true, value: { outcomes, removedAssets } }
}
