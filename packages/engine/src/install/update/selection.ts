/**
 * What an update run selects, and why a run selects nothing.
 *
 * These are update-domain decisions, not presentation ones. Which rows a
 * chooser may offer, what a flagless run takes, and which kind of
 * "nothing to do" a project is in are all answered from the plan and the
 * mode alone — no terminal, no rendering, no user in the loop. A GUI or
 * an RPC server driving the same engine would need every one of these
 * answers and would have to reach the same verdicts, which is what makes
 * this the wrong knowledge for a display layer to hold.
 *
 * The one thing deliberately left out is the wording. Turning a
 * `UpdateNoOp` into a sentence is presentation, and it lives with the
 * surface that prints it.
 */

import { advancingChoice } from './advancing.ts'
import type { FacetUpdateSelection } from './apply.ts'
import type { UpdateChoice } from './manifest-source.ts'
import type { UpdatePlanRow } from './types.ts'

/**
 * Which version a non-interactive run takes for each facet.
 *
 * `range` respects what `facets.json` declares; `latest` ignores it. The
 * flag is the whole difference, so it is the whole type.
 */
export type UpdateMode = UpdateChoice

/** A plan row that has at least one version newer than what is installed. */
export type UpdateCandidate = Extract<UpdatePlanRow, { kind: 'candidate' }>

/**
 * The rows a chooser can offer, in project order.
 *
 * Deliberately independent of the mode's default selections. A facet
 * pinned to an exact version has a stationary Target and may still have
 * an advancing Latest — under a plain interactive run its default
 * selection is empty while the row it would show is precisely the one
 * the chooser exists for. Gating on the defaults instead sent that user
 * to the "ranges permit none, pass --latest" message, telling them to
 * re-run with a flag whose job the chooser was already there to do.
 */
export function candidateRows(plan: readonly UpdatePlanRow[]): UpdateCandidate[] {
  return plan.filter((row): row is UpdateCandidate => row.kind === 'candidate')
}

/**
 * Every candidate whose chosen version advances, in project order.
 *
 * This is what a run with no user in it takes. Interactive selection
 * never uses it: every choice is made on screen, so the mode has nothing
 * left to say there.
 *
 * `advancingChoice` is the same predicate a chooser gates selection on
 * and the same one `validateFacetUpdateSelections` accepts by, so a
 * default selection cannot contain a row application would refuse.
 */
export function defaultSelections(plan: readonly UpdatePlanRow[], mode: UpdateMode): FacetUpdateSelection[] {
  const selections: FacetUpdateSelection[] = []
  for (const row of candidateRows(plan)) {
    if (advancingChoice(row.facet, mode) === undefined) continue
    selections.push({ facetName: row.facet.name, choice: mode })
  }
  return selections
}

/**
 * Why a successful run is about to apply nothing.
 *
 * Four distinct facts, and a user acts on each of them differently: add
 * a facet, do nothing, ask for latest, or (the last one) nothing at all.
 * Collapsing them into "no updates available" is what makes the third
 * case — releases exist, the declared ranges just forbid them — look
 * like the second.
 */
export type UpdateNoOp =
  | { reason: 'no-registry-facets' }
  | { reason: 'all-current' }
  | { reason: 'ranges-permit-none' }
  | { reason: 'latest-permits-none' }

/**
 * Classify an empty selection. Returns `null` when there is work to do,
 * so a caller cannot reach a no-op verdict while holding selections.
 */
export function classifyNoOp(
  plan: readonly UpdatePlanRow[],
  mode: UpdateMode,
  selections: readonly FacetUpdateSelection[],
): UpdateNoOp | null {
  if (selections.length > 0) return null

  const registryRows = plan.filter((row) => row.kind !== 'unsupported-source')
  if (registryRows.length === 0) return { reason: 'no-registry-facets' }

  if (candidateRows(plan).length === 0) return { reason: 'all-current' }

  // Something newer exists and this mode cannot reach it. Under a plain
  // run that is the authored range's doing and latest mode is the way
  // past it; under latest mode there is nothing left to suggest.
  return mode === 'range' ? { reason: 'ranges-permit-none' } : { reason: 'latest-permits-none' }
}
