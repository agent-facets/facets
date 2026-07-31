import type { AssetType } from '@agent-facets/common'
import {
  ASSET_DIRECTORY,
  ASSET_TYPES,
  type FacetMaterializationOverrides,
  overrideFor,
  overridesForType,
  type ProjectAssetOverride,
  type StaleOverride,
} from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { ownEntry, ownRecord } from '../own-entry.ts'

/**
 * Finalize the project's materialization intent for the commit.
 *
 * Compose decides what the effective set is; this decides what `facets.json`
 * should say about it. Two things have to happen here and nowhere else:
 *
 *   1. **Persist the accepted overrides.** They may be the ones already on
 *      disk, or the ones an interactive resolver chose. Compose returns one
 *      map either way, so the writer never has to know which happened.
 *   2. **Prune stale overrides.** An override naming an asset the resolved
 *      facet version no longer contains is dropped — but only here, on the
 *      way into a successful transaction. An override is durable project
 *      intent, so a failed operation must leave it exactly where it was.
 *
 * Both mutate the in-memory desired set only. Nothing reaches disk until the
 * tri-write, which is what makes "pruned only on success" true by
 * construction rather than by remembering to undo something.
 */

/** An override that was dropped, and the identity it named. */
export interface PrunedOverride {
  facet: string
  type: AssetType
  authoredName: string
}

function staleKey(facet: string, type: AssetType, authoredName: string): string {
  return `${facet}\u0000${type}\u0000${authoredName}`
}

/**
 * Rebuild one facet's override map without its stale entries.
 *
 * Returns `undefined` when nothing survives: the canonical form of a facet
 * with no overrides is its compact source string, and `applyDesiredFacets`
 * collapses the entry only when the value it is handed is absent rather than
 * an empty object.
 */
function pruneFacetOverrides(
  facet: string,
  overrides: FacetMaterializationOverrides,
  stale: ReadonlySet<string>,
  pruned: PrunedOverride[],
): FacetMaterializationOverrides | undefined {
  const next: {
    skills?: Record<string, ProjectAssetOverride>
    agents?: Record<string, ProjectAssetOverride>
    commands?: Record<string, ProjectAssetOverride>
  } = {}
  let kept = 0

  for (const type of ASSET_TYPES) {
    const record = overridesForType(overrides, type)
    if (record === undefined) continue
    // Null-prototype: keyed by authored asset name, which `constructor` and
    // `__proto__` are both legal values of. A retained override written into a plain
    // object under the latter would be dropped from the manifest silently.
    const retained = ownRecord<ProjectAssetOverride>()
    let retainedCount = 0
    for (const authoredName of Object.keys(record)) {
      const disposition = overrideFor(overrides, type, authoredName)
      if (disposition === undefined) continue
      if (stale.has(staleKey(facet, type, authoredName))) {
        pruned.push({ facet, type, authoredName })
        continue
      }
      retained[authoredName] = disposition
      retainedCount += 1
    }
    if (retainedCount > 0) {
      next[ASSET_DIRECTORY[type]] = retained
      kept += retainedCount
    }
  }

  return kept > 0 ? next : undefined
}

/**
 * Fold Compose's accepted overrides into the desired manifest entries,
 * dropping every reported stale override. Mutates `desiredFacets` in place
 * and returns the overrides that were actually removed, so the caller can
 * report them after the transaction commits.
 *
 * A facet absent from `accepted` ends up with no overrides. That is the
 * contract of the resolver's answer, which is the COMPLETE intent map rather
 * than a patch — Compose already re-planned the whole draft from it, so the
 * writer must not reintroduce entries the planner did not see.
 */
export function finalizeMaterializationIntent(
  desiredFacets: Record<string, NormalizedFacetEntry>,
  accepted: Readonly<Record<string, FacetMaterializationOverrides>>,
  staleOverrides: readonly StaleOverride[],
): readonly PrunedOverride[] {
  const stale = new Set(staleOverrides.map((s) => staleKey(s.facet, s.type, s.authoredName)))
  const pruned: PrunedOverride[] = []

  for (const [facet, entry] of Object.entries(desiredFacets)) {
    const overrides = ownEntry(accepted, facet)
    entry.overrides = overrides === undefined ? undefined : pruneFacetOverrides(facet, overrides, stale, pruned)
  }

  return pruned
}
