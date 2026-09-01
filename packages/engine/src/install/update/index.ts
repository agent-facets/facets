/**
 * Update planning: the engine surface `facet update` is built on.
 *
 * Only the two-phase entry point and the shapes the CLI has to render
 * are re-exported. Discovery, grouping, version ordering, and specifier
 * rewriting stay behind this boundary on purpose — every one of them is
 * a question the engine answers once so the CLI cannot answer it a
 * second, slightly different way.
 */

export { advancingChoice, displayedVersion, hasAdvancingChoice } from './advancing.ts'
export type {
  FacetUpdateSelection,
  RunPreparedFacetUpdateOptions,
  RunPreparedFacetUpdateResult,
  UpdateSelectionFailure,
} from './apply.ts'
export { runPreparedFacetUpdate, validateFacetUpdateSelections } from './apply.ts'
export type { AuthoredSpecifier, UpdateChoice } from './manifest-source.ts'
export { type PrepareFacetUpdateArgs, prepareFacetUpdate } from './prepare.ts'
export type { UpdateCandidate, UpdateMode, UpdateNoOp } from './selection.ts'
export { candidateRows, classifyNoOp, defaultSelections } from './selection.ts'
export type {
  CheckableRegistryFacet,
  PreparedFacetUpdate,
  PrepareFacetUpdateFailure,
  PrepareFacetUpdateResult,
  ResolvedChoice,
  TargetVersion,
  UnusableFacetState,
  UnusableStateReason,
  UpdatePlanRow,
} from './types.ts'
export type { ExactVersion } from './version-order.ts'
