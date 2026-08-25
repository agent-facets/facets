import type { PrepareFacetUpdateFailure, UnusableFacetState, UpdateSelectionFailure } from '@agent-facets/engine'
import type { CliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'
import { unsupportedManifestVersionError } from '../../util/unsupported-manifest-version.ts'

/**
 * Why an update could not even be planned, in the CLI's words.
 *
 * Returns the error rather than writing it, so the `switch` has to
 * produce a value: a `void` switch with no `default` compiles happily
 * when the engine grows a new failure reason, and then prints nothing
 * for it.
 */
export function updatePrepareCliError(failure: PrepareFacetUpdateFailure): CliError {
  switch (failure.reason) {
    case 'manifest-read':
      return {
        what: 'could not read facets.json',
        detail: failure.error,
        fix: 'run this command inside a project with a valid facets.json',
      }
    case 'manifest-unsupported-version':
      return unsupportedManifestVersionError(failure)
    case 'lockfile-read':
      return {
        what: 'could not read facets.lock',
        detail: failure.error,
        fix: "repair facets.lock, or delete it and run 'facet install' to rebuild it",
      }
    case 'unusable-facet-state':
      // Update refuses to guess what is installed. Every affected facet is
      // named because the remedy is one `facet install` covering all of
      // them, and a list that stopped at the first would send the user
      // round the same loop for each.
      return {
        what: 'this project cannot be checked for updates yet',
        detail: failure.facets.map(describeUnusableFacet).join('; '),
        fix: "run 'facet install' to bring facets.lock in line with facets.json, then update again",
      }
    case 'discovery-failed':
      // The registry's own words, through the shared translator. Update has
      // nothing to add: a lookup failure here is the same failure any other
      // registry read would report.
      return translateEngineRegistryError(failure.error)
    case 'invalid-resolved-version':
      return {
        what: `the registry returned an unusable ${failure.lookup} version for ${failure.facet}`,
        detail: `"${failure.version}" is not an exact MAJOR.MINOR.PATCH release`,
        fix: 'try again in a moment; if it persists, report it with the facet name above',
      }
    case 'target-outside-range':
      return {
        what: `the registry resolved ${failure.facet} outside its declared range`,
        detail: `facets.json declares ${failure.source}, which ${failure.version} does not satisfy`,
        fix: 'try again in a moment; if it persists, report it with the facet name above',
      }
    case 'project-changed-during-discovery':
      return {
        what: `${failure.file === 'manifest' ? 'facets.json' : 'facets.lock'} changed while update was checking versions`,
        detail: 'the plan would have described a project that no longer exists, so it was withdrawn',
        fix: "re-run 'facet update' once the other change has finished",
      }
  }
}

/** One facet's unusable local state, phrased for a single-line list. */
function describeUnusableFacet(entry: UnusableFacetState): string {
  const { name, reason } = entry
  switch (reason.code) {
    case 'unparseable-source':
      return `${name}: facets.json declares "${reason.source}" (${reason.problem})`
    case 'missing-lock-entry':
      return `${name}: not in facets.lock`
    case 'lock-source-mismatch':
      return `${name}: facets.lock records a ${reason.locked} source`
    case 'invalid-locked-version':
      return `${name}: facets.lock records "${reason.version}", which is not an exact release`
    case 'locked-version-unsatisfying':
      return `${name}: installed ${reason.version} does not satisfy ${reason.source}`
  }
}

/**
 * Why a set of chosen updates could not be applied.
 *
 * Every arm here is the command asking for something the reviewed plan
 * cannot answer, so each one is a defect in this CLI rather than
 * something the user typed — except the empty selection, which the
 * command is expected to have classified as a no-op before ever getting
 * here.
 */
export function updateSelectionCliError(failure: UpdateSelectionFailure): CliError {
  const bug = 'file a bug — this is a defect in the CLI, not your project'
  switch (failure.reason) {
    case 'empty-selection':
      return { what: 'nothing was selected to update', detail: 'the update plan selected no facets', fix: bug }
    case 'duplicate-facet':
      return { what: 'a facet was selected twice', detail: failure.facet, fix: bug }
    case 'unknown-facet':
      return { what: 'a selected facet is not in the update plan', detail: failure.facet, fix: bug }
    case 'unsupported-source':
      return {
        what: `${failure.facet} cannot be updated from the registry`,
        detail: `facets.json declares it as a ${failure.sourceKind} source`,
        fix: 'update git and local facets by changing their source in facets.json',
      }
    case 'not-a-candidate':
      return { what: `${failure.facet} has no newer release to install`, detail: 'it is already current', fix: bug }
    case 'choice-does-not-advance':
      return {
        what: `the ${failure.choice === 'range' ? 'range target' : 'latest release'} for ${failure.facet} is not newer`,
        detail: `${failure.version} does not advance the installed ${failure.current}`,
        fix: bug,
      }
  }
}
