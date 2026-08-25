import type { FacetUpdateSelection, UpdateChoice, UpdatePlanRow } from '@agent-facets/engine'

/**
 * Which version a non-interactive run takes for each facet.
 *
 * `range` respects what `facets.json` declares; `latest` ignores it. The
 * flag is the whole difference, so it is the whole type.
 */
export type UpdateMode = UpdateChoice

/**
 * Whether a candidate's chosen version is actually newer than what is
 * installed.
 *
 * Read from the engine's `advancing` tag rather than compared here. The
 * engine resolved both versions and already answered this question; a
 * second comparison in the CLI is a second answer waiting to disagree
 * with the one application enforces.
 */
export function choiceAdvances(row: Extract<UpdatePlanRow, { kind: 'candidate' }>, choice: UpdateChoice): boolean {
  switch (row.advancing) {
    case 'range-and-latest':
      return true
    case 'range-only':
      return choice === 'range'
    case 'latest-only':
      return choice === 'latest'
  }
}

/** Every candidate whose chosen version advances, in project order. */
export function defaultSelections(plan: readonly UpdatePlanRow[], mode: UpdateMode): FacetUpdateSelection[] {
  const selections: FacetUpdateSelection[] = []
  for (const row of plan) {
    if (row.kind !== 'candidate') continue
    if (!choiceAdvances(row, mode)) continue
    selections.push({ facetName: row.facet.name, choice: mode })
  }
  return selections
}

/**
 * Why a successful run is about to apply nothing.
 *
 * Four distinct facts, and a user acts on each of them differently: add
 * a facet, do nothing, pass `--latest`, or (the last one) nothing at
 * all. Collapsing them into "no updates available" is what makes the
 * third case — releases exist, the declared ranges just forbid them —
 * look like the second.
 */
export type UpdateNoOp =
  | { reason: 'no-registry-facets' }
  | { reason: 'all-current' }
  | { reason: 'ranges-permit-none' }
  | { reason: 'latest-permits-none' }

/**
 * Classify an empty selection. Returns `null` when there is work to do,
 * so the caller cannot reach a no-op message while holding selections.
 */
export function classifyNoOp(
  plan: readonly UpdatePlanRow[],
  mode: UpdateMode,
  selections: readonly FacetUpdateSelection[],
): UpdateNoOp | null {
  if (selections.length > 0) return null

  const registryRows = plan.filter((row) => row.kind !== 'unsupported-source')
  if (registryRows.length === 0) return { reason: 'no-registry-facets' }

  const candidates = plan.filter((row) => row.kind === 'candidate')
  if (candidates.length === 0) return { reason: 'all-current' }

  // Something newer exists and this mode cannot reach it. Under plain
  // update that is the authored range's doing and `--latest` is the way
  // past it; under `--latest` there is nothing left to suggest.
  return mode === 'range' ? { reason: 'ranges-permit-none' } : { reason: 'latest-permits-none' }
}

/** The message for each no-op, including the one that has a next step. */
export function describeNoOp(noOp: UpdateNoOp): string {
  switch (noOp.reason) {
    case 'no-registry-facets':
      return 'No registry facets to update. Only registry-backed facets can be checked for newer releases.'
    case 'all-current':
      return 'All registry facets are current.'
    case 'ranges-permit-none':
      return 'Newer releases exist, but the ranges in facets.json permit none of them. Run `facet update --latest` to take them anyway.'
    case 'latest-permits-none':
      return 'No registry facet has a newer release than the one installed.'
  }
}
