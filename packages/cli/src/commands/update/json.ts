import {
  advancingChoice,
  type CheckableRegistryFacet,
  describeVersionSpec,
  displayedVersion,
  hasAdvancingChoice,
  type UpdatePlanRow,
} from '@agent-facets/engine'
import type { CliError } from '../../util/errors.ts'
import type { UpdateMode } from './selection.ts'

/**
 * Bump this whenever the document below changes shape. Consumers pin it,
 * so a silent change is a broken script somewhere we never hear about.
 */
export const UPDATE_JSON_SCHEMA_VERSION = '1'

/**
 * What this run does about one facet.
 *
 * `updated` and `held` are both about the run, not the range: a facet
 * with a newer release is `updated` when this invocation takes it and
 * `held` when it leaves it alone. The same facet is one or the other
 * depending on whether `--latest` was passed.
 */
export type UpdateOutcome = 'updated' | 'current' | 'held' | 'unsupported'

/** One row of the plan, flattened to strings a script can read. */
export interface UpdateJsonFacet {
  name: string
  /** The specifier exactly as it is written in facets.json. */
  declared: string
  /** Installed version, or null for a row we cannot check versions for. */
  current: string | null
  /** What the declared specifier resolves to now, or null. */
  target: string | null
  /** The registry's newest release, or null. */
  latest: string | null
  outcome: UpdateOutcome
}

/** How many facets landed in each outcome. Always sums to `facets.length`. */
export interface UpdateJsonCounts {
  updated: number
  current: number
  held: number
  unsupported: number
}

export interface UpdateDocument {
  schemaVersion: string
  ok: true
  /** True when the run actually wrote; false for a dry run or `outdated`. */
  applied: boolean
  facets: UpdateJsonFacet[]
  counts: UpdateJsonCounts
}

export interface UpdateErrorDocument {
  schemaVersion: string
  ok: false
  error: {
    what: string
    detail: string | undefined
    fix: string
  }
}

/**
 * Which outcome a checkable facet gets, asked of the engine rather than
 * worked out here.
 *
 * The order matters. "Does this run move it?" is `advancingChoice` for
 * the mode we are in. Only once that is no is it worth asking whether
 * anything newer exists at all — and that question is `hasAdvancingChoice`,
 * which looks at both columns. Asking it of the `latest` column alone
 * would get the wrong answer whenever the registry's newest release has
 * moved backwards (a release was unpublished) while the range target
 * still advances: nothing newer in the `latest` column, plenty newer in
 * the range, and the facet is held rather than current.
 */
function facetOutcome(facet: CheckableRegistryFacet, mode: UpdateMode): Exclude<UpdateOutcome, 'unsupported'> {
  if (advancingChoice(facet, mode) !== undefined) return 'updated'
  if (hasAdvancingChoice(facet)) return 'held'
  return 'current'
}

/**
 * One plan row as a document entry.
 *
 * Note what this does not look at: whether the row is a `candidate` or a
 * `current`. Those are the engine's summary of the same two versions the
 * entry already carries, and re-reading the summary instead of the
 * versions is how a document starts disagreeing with the run it
 * describes. Only `unsupported-source` needs the row's kind, because it
 * is the one variant with no facet to ask about.
 */
function facetEntry(row: UpdatePlanRow, mode: UpdateMode): UpdateJsonFacet {
  switch (row.kind) {
    case 'unsupported-source':
      return {
        name: row.name,
        declared: row.source,
        current: null,
        target: null,
        latest: null,
        outcome: 'unsupported',
      }
    case 'candidate':
    case 'current': {
      const facet = row.facet
      return {
        name: facet.name,
        declared: facet.authored.source,
        current: describeVersionSpec(facet.current),
        target: describeVersionSpec(displayedVersion(facet, 'range')),
        latest: describeVersionSpec(displayedVersion(facet, 'latest')),
        outcome: facetOutcome(facet, mode),
      }
    }
    default: {
      const unreachable: never = row
      throw new Error(`unreachable update plan row: ${JSON.stringify(unreachable)}`)
    }
  }
}

/** Tally the outcomes the entries actually got, so the counts cannot drift from them. */
function countOutcomes(facets: readonly UpdateJsonFacet[]): UpdateJsonCounts {
  const counts: UpdateJsonCounts = { updated: 0, current: 0, held: 0, unsupported: 0 }
  for (const facet of facets) counts[facet.outcome] += 1
  return counts
}

/**
 * The document `facet update --json` prints.
 *
 * Takes data and returns data — no stdout, no process, nothing to stub —
 * so every outcome can be checked by calling it. `applied` is the
 * caller's to tell us: this function cannot know whether the run that
 * produced the plan went on to write anything.
 */
export function buildUpdateJson(input: {
  plan: readonly UpdatePlanRow[]
  mode: UpdateMode
  applied: boolean
}): UpdateDocument {
  const facets = input.plan.map((row) => facetEntry(row, input.mode))
  return {
    schemaVersion: UPDATE_JSON_SCHEMA_VERSION,
    ok: true,
    applied: input.applied,
    facets,
    counts: countOutcomes(facets),
  }
}

/**
 * The document printed instead when the update fails.
 *
 * It takes the same `CliError` the human-readable path prints, which is
 * the point: the two can never describe a failure differently, and a new
 * engine failure reason cannot reach the terminal without also reaching
 * this document.
 */
export function buildUpdateErrorJson(error: CliError): UpdateErrorDocument {
  return {
    schemaVersion: UPDATE_JSON_SCHEMA_VERSION,
    ok: false,
    error: {
      what: error.what,
      detail: error.detail,
      fix: error.fix,
    },
  }
}
