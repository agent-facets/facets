/**
 * The one answer to "would taking this column actually move the facet?"
 *
 * Every layer needs it and none of them may have its own copy. The
 * picker decides from it whether a row can be selected, the mode
 * defaults decide from it what a flagless run takes, and selection
 * validation decides from it what it will accept — three places that
 * have to agree exactly, because a disagreement shows up as a user
 * confirming a row the engine then rejects as a CLI defect.
 */

import type { UpdateChoice } from './manifest-source.ts'
import type { CheckableRegistryFacet, ResolvedChoice } from './types.ts'
import { type ExactVersion, isNewerThan } from './version-order.ts'

/**
 * The release a column would install, or `undefined` when that column
 * is not newer than what is installed.
 *
 * Returning the choice rather than a boolean is what keeps the check
 * and the thing being checked together: a caller that has proved a
 * column advances is handed the exact metadata to install for it, and
 * cannot pick up a different one on the way.
 *
 * A pinned Target never advances. It resolves to the installed version
 * by definition, and discovery never asked the registry about it, so
 * there is no release here to hand back.
 */
export function advancingChoice(facet: CheckableRegistryFacet, choice: UpdateChoice): ResolvedChoice | undefined {
  if (choice === 'latest') {
    return isNewerThan(facet.latest.version, facet.current) ? facet.latest : undefined
  }
  if (facet.target.kind === 'pinned') return undefined
  return isNewerThan(facet.target.version, facet.current) ? facet.target : undefined
}

/** True when either column offers something newer than what is installed. */
export function hasAdvancingChoice(facet: CheckableRegistryFacet): boolean {
  return advancingChoice(facet, 'range') !== undefined || advancingChoice(facet, 'latest') !== undefined
}

/**
 * The version a column displays, advancing or not.
 *
 * Distinct from `advancingChoice` because rendering and refusal both
 * need the stationary case: a pinned row still shows its Target, and a
 * rejected selection still has to name the version that failed to move.
 */
export function displayedVersion(facet: CheckableRegistryFacet, choice: UpdateChoice): ExactVersion {
  return choice === 'latest' ? facet.latest.version : facet.target.version
}
