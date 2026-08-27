import type { UpdateNoOp } from '@agent-facets/engine'

// Which rows are offerable, what a flagless run takes, and which kind of
// no-op a project is in are engine decisions — re-exported here so the
// command's own modules keep importing selection concepts from one
// place, rather than restated as a second opinion.
export type { UpdateCandidate, UpdateMode, UpdateNoOp } from '@agent-facets/engine'
export { candidateRows, classifyNoOp, defaultSelections } from '@agent-facets/engine'

/**
 * The message for each no-op, including the one that has a next step.
 *
 * The only part of this that is the CLI's: the classification is a fact
 * about the project, the sentence is a choice about this terminal. It
 * names flags because a terminal is where flags exist.
 */
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
