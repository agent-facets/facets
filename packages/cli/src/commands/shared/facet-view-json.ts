import { type LoadFacetViewFailure, manifestLoadFailure } from '@agent-facets/engine'
import type { JsonError } from '../../util/json-output.ts'
import { facetViewError } from './facet-view-errors.ts'

/**
 * How `facet info --json` and `facet cat --json` report a facet they could
 * not load. The message and fix are the same ones the human error block
 * shows; the code and details come from the structured failure, never from
 * parsing that text.
 */
export function facetViewJsonError(projectRoot: string, requested: string, failure: LoadFacetViewFailure): JsonError {
  const human = facetViewError(projectRoot, requested, failure)
  return {
    code: failureCode(projectRoot, failure),
    message: human.what,
    ...detailsOf(failure, human.detail),
    fix: human.fix,
    ...(human.docsUrl !== undefined ? { docsUrl: human.docsUrl } : {}),
  }
}

function failureCode(projectRoot: string, failure: LoadFacetViewFailure): string {
  switch (failure.code) {
    case 'project-manifest':
      if (failure.result.reason === 'read') return 'INVALID_MANIFEST'
      return manifestLoadFailure(projectRoot, failure.result).reason === 'manifest-unsupported-version'
        ? 'UNSUPPORTED_MANIFEST_VERSION'
        : 'INVALID_MANIFEST'
    case 'lockfile-unreadable':
      return 'INVALID_LOCKFILE'
    case 'registry':
      return failure.error.code
    case 'manifest-invalid':
      return 'INVALID_PUBLISHED_MANIFEST'
    case 'name-mismatch':
      return 'NAME_MISMATCH'
    case 'integrity-mismatch':
      return 'INTEGRITY_MISMATCH'
    case 'local-copy-unavailable':
      return 'LOCAL_COPY_UNAVAILABLE'
  }
}

function detailsOf(failure: LoadFacetViewFailure, detail: string | undefined): { details?: unknown } {
  switch (failure.code) {
    case 'manifest-invalid':
      return { details: { issues: failure.errors.map((error) => ({ message: error.message, path: error.path })) } }
    case 'name-mismatch':
      return { details: { manifestName: failure.manifestName } }
    case 'integrity-mismatch':
      return { details: { expected: failure.expected, observed: failure.observed } }
    case 'local-copy-unavailable':
      return { details: { sourceKind: failure.sourceKind } }
    default:
      return detail === undefined || detail.length === 0 ? {} : { details: { message: detail } }
  }
}
