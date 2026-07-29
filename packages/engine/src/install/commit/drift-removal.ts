import type { SupportedLockfile } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { ownEntry } from '../own-entry.ts'
import type { ProjectReceiptState } from '../receipt.ts'
import type { FacetOutcome } from '../types.ts'

export interface DriftRemovalArgs {
  desiredFacets: Readonly<Record<string, NormalizedFacetEntry>>
  receiptState: ProjectReceiptState
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
 * pull` can drop a lockfile entry but cannot touch machine-local state.
 *
 * A lockfile-only entry is still reported, because dropping a facet the
 * project declared IS a change — but as `removed-untracked`, because it is a
 * change to the project's records only. It confers no ownership, so nothing on
 * disk is deleted on its behalf; that decision belongs entirely to
 * `buildPreviousOwnership`, which reads the receipt and nothing else. Which of
 * the two outcomes a facet gets is therefore the same question as whether it
 * appears in that index.
 */
export function removedFacetOutcomes(args: DriftRemovalArgs): FacetOutcome[] {
  const { desiredFacets, receiptState, previousLockfile } = args
  const tracked = receiptState.kind === 'loaded' ? receiptState.receipt.facets : undefined

  const unwantedFromReceipt =
    tracked === undefined ? [] : Object.keys(tracked).filter((name) => ownEntry(desiredFacets, name) === undefined)
  const unwantedFromLockfile = Object.keys(previousLockfile.facets).filter(
    (name) =>
      ownEntry(desiredFacets, name) === undefined && (tracked === undefined || ownEntry(tracked, name) === undefined),
  )

  return [...new Set([...unwantedFromReceipt, ...unwantedFromLockfile])].sort().map((name) => {
    const recorded = tracked === undefined ? undefined : ownEntry(tracked, name)
    const locked = ownEntry(previousLockfile.facets, name)
    return {
      kind: recorded === undefined ? ('removed-untracked' as const) : ('removed' as const),
      name,
      oldVersion: recorded?.version ?? locked?.version ?? '0.0.0',
    }
  })
}
