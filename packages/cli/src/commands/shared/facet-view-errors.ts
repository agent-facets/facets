import { type LoadFacetViewFailure, manifestLoadFailure } from '@agent-facets/engine'
import type { CliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'
import { safeText, shellQuote } from '../../util/terminal-safe.ts'
import { unsupportedManifestVersionError } from '../../util/unsupported-manifest-version.ts'

/** How `facet info` and `facet cat` report a facet they could not load. */
export function facetViewError(projectRoot: string, requested: string, failure: LoadFacetViewFailure): CliError {
  const name = safeText(requested)
  switch (failure.code) {
    case 'project-manifest': {
      if (failure.result.reason === 'read') {
        return {
          what: 'facets.json could not be read',
          detail: failure.result.error,
          fix: 'check that the file is readable, then try again',
        }
      }
      const loadFailure = manifestLoadFailure(projectRoot, failure.result)
      if (loadFailure.reason === 'manifest-unsupported-version') return unsupportedManifestVersionError(loadFailure)
      return {
        what: 'facets.json is malformed',
        detail: loadFailure.error,
        fix: 'fix the JSON syntax or schema errors and try again',
      }
    }
    case 'lockfile-unreadable':
      return { what: 'facets.lock could not be read', detail: failure.error, fix: 'run: facet install' }
    case 'registry':
      if (failure.error.code === 'NOT_FOUND') {
        return { what: `facet "${name}" not found`, fix: `run: facet search ${safeText(shellQuote(requested))}` }
      }
      return translateEngineRegistryError(failure.error)
    case 'manifest-invalid':
      return {
        what: `the published manifest for "${name}" is invalid`,
        detail: safeText(failure.errors.map((error) => `${error.path}: ${error.message}`).join('; ')),
        fix: 'try again later; if it persists, report it to the facet publisher',
      }
    case 'name-mismatch':
      return {
        what: `the manifest for "${name}" names a different facet ("${safeText(failure.manifestName)}")`,
        fix: 'run: facet install',
      }
    case 'integrity-mismatch':
      return {
        what: `the registry's copy of "${name}" does not match facets.lock`,
        detail: `expected ${failure.expected}, got ${failure.observed}`,
        fix: 'run: facet install',
      }
    case 'local-copy-unavailable':
      return {
        what: `no verified local copy of "${name}" is available`,
        detail: `the ${failure.sourceKind} copy is missing or does not match facets.lock`,
        fix: 'run: facet install',
      }
  }
}
