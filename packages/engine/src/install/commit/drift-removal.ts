import type { SupportedLockfile } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import type { Receipt } from '../receipt.ts'
import type { FacetOutcome } from '../types.ts'

export interface DriftRemovalArgs {
  desiredFacets: Readonly<Record<string, NormalizedFacetEntry>>
  receipt: Receipt
  previousLockfile: SupportedLockfile
}

/**
 * The facets this machine materialized but the desired set no longer wants.
 *
 * This is now a pure computation. Deleting their assets is NOT done here:
 * ownership is keyed by effective adapter identity in a single global pass, so
 * a name one of these facets gives up can be inherited by a facet that is
 * still wanted instead of being deleted out from under it. What remains here
 * is the *reporting* question — which facets should be summarized as removed —
 * which is genuinely per-facet.
 *
 * The comparison is against the RECEIPT first, never only the on-disk
 * lockfile: that is what makes orphan-on-pull recoverable, because a `git
 * pull` can drop a lockfile entry but cannot touch machine-local state. A
 * lockfile-only entry is still caught, for the case where a receipt exists but
 * predates the entry.
 */
export function removedFacetOutcomes(args: DriftRemovalArgs): FacetOutcome[] {
  const { desiredFacets, receipt, previousLockfile } = args

  const unwantedFromReceipt = Object.keys(receipt.facets).filter((name) => desiredFacets[name] === undefined)
  const unwantedFromLockfile = Object.keys(previousLockfile.facets).filter(
    (name) => desiredFacets[name] === undefined && !receipt.facets[name],
  )
  const unwantedNames = [...new Set([...unwantedFromReceipt, ...unwantedFromLockfile])].sort()

  return unwantedNames.map((name) => ({
    kind: 'removed' as const,
    name,
    oldVersion: receipt.facets[name]?.version ?? previousLockfile.facets[name]?.version ?? '0.0.0',
  }))
}
