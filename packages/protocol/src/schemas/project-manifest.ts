import { validateAssetName } from '@agent-facets/common'
import { type } from 'arktype'
import { ASSET_DIRECTORY } from '../materialization/identity.ts'
import { ProjectAssetOverrideSchema } from './materialization.ts'

// --- Format-version constants (exact dispatch, design D4/D10) ---

/**
 * The current project-manifest format version.
 *
 * This is the FIRST explicit version `facets.json` has carried. It evolves
 * independently of `FACET_ARCHIVE_VERSION`, `CURRENT_LOCKFILE_VERSION`, and
 * the adapter API version — four separate compatibility axes that happen to
 * share release trains, not one version in four places.
 */
export const CURRENT_PROJECT_MANIFEST_VERSION = 0.1

/**
 * The tag identifying a legacy manifest, which predates versioning and is
 * recognized by the ABSENCE of `manifestVersion`. It is a string rather than
 * a number precisely because there is no number to observe — modelling it as
 * `0` or `undefined` would make "unversioned" and "declared something we
 * cannot read" indistinguishable in dispatch results.
 */
export const LEGACY_PROJECT_MANIFEST_VERSION = 'legacy-unversioned'

/**
 * Every explicitly-declared version this implementation can read. A legacy
 * unversioned document is also accepted but declares nothing, so it has no
 * member here.
 */
export const SUPPORTED_PROJECT_MANIFEST_VERSIONS: readonly number[] = [CURRENT_PROJECT_MANIFEST_VERSION]

// --- Materialization overrides ---

/**
 * Per-asset materialization overrides for one facet, grouped by asset type.
 *
 * Grouping by type avoids inventing a parseable `type:name` string grammar,
 * and using maps (rather than arrays of records) makes a duplicate typed
 * override unrepresentable in a well-formed document. Keys are AUTHORED
 * asset names; values are the `aliased` and `omitted` arms only, because
 * absence of an override already means authored materialization.
 *
 * Authored keys are validated with the path-safety guard rather than the
 * stricter single-segment grammar: a project must remain able to alias or
 * omit an asset published by an older, more permissive facet format. Alias
 * VALUES are held to the current grammar by `ProjectAssetOverrideSchema` —
 * a project may address a legacy name but never mint a new one.
 */
const MaterializationOverrides = type({
  'skills?': type.Record('string', ProjectAssetOverrideSchema),
  'agents?': type.Record('string', ProjectAssetOverrideSchema),
  'commands?': type.Record('string', ProjectAssetOverrideSchema),
  // Arktype tolerates undeclared keys by default, which is right for
  // forward-compatible extension data but wrong here: the group name IS the
  // asset type, so `skillz` is not a field we do not understand yet — it is
  // a misspelling of one we do. Accepting it would silently discard the very
  // intent the override exists to record.
  '+': 'reject',
}).narrow((data, ctx) => {
  const groups = [
    [ASSET_DIRECTORY.skill, data.skills],
    [ASSET_DIRECTORY.agent, data.agents],
    [ASSET_DIRECTORY.command, data.commands],
  ] as const

  let total = 0
  for (const [group, record] of groups) {
    if (!record) continue
    for (const authoredName of Object.keys(record)) {
      total++
      const check = validateAssetName(authoredName)
      if (!check.ok) {
        return ctx.mustBe(`${group} override key "${authoredName}" ${check.reason}`)
      }
    }
  }

  // An expanded entry exists solely to carry overrides. An empty one is a
  // second spelling of the compact form, so the canonical writer collapses
  // it back to a source string rather than emitting this shape.
  if (total === 0) {
    return ctx.mustBe('an expanded facet entry declaring at least one materialization override')
  }
  return true
})

/**
 * An expanded facet entry: a source specifier plus the project's
 * materialization intent for that facet's assets.
 *
 * `source` carries exactly the same string a compact entry would, so
 * switching a facet between forms never changes how its source resolves.
 */
const ExpandedFacetEntry = type({
  source: 'string',
  materialization: MaterializationOverrides,
})

/**
 * A facet entry under the current schema: the compact source string when the
 * facet needs no overrides (the canonical form), or the expanded object when
 * it does.
 */
const CurrentFacetEntry = type('string').or(ExpandedFacetEntry)

// --- Versioned schemas ---

/**
 * Legacy unversioned project-manifest schema — the shape `facets.json` had
 * before it carried a format version. Every facet value MUST be a compact
 * source string; an expanded entry in an unversioned document is rejected
 * rather than reinterpreted as current (design D4: no shape-based fallback).
 *
 * A declared `manifestVersion` is rejected here so the two format
 * generations are unrepresentable in one validated document, mirroring how
 * the legacy build manifest rejects a current-format `files` map.
 */
export const LegacyProjectManifestSchema = type({
  facets: type.Record('string', 'string'),
}).narrow((data, ctx) => {
  if (Object.hasOwn(data, 'manifestVersion')) {
    return ctx.mustBe('a legacy project manifest without an explicit "manifestVersion"')
  }
  return true
})

/** Inferred TypeScript type for a validated legacy unversioned manifest */
export type LegacyProjectManifest = typeof LegacyProjectManifestSchema.infer

/**
 * Current (`0.1`) project-manifest schema: exact numeric
 * `manifestVersion: 0.1` plus facet entries that may be compact source
 * strings or expanded entries carrying materialization overrides.
 */
export const CurrentProjectManifestSchema = type({
  manifestVersion: type.unit(CURRENT_PROJECT_MANIFEST_VERSION),
  facets: type.Record('string', CurrentFacetEntry),
})

/** Inferred TypeScript type for a validated current (`0.1`) manifest */
export type CurrentProjectManifest = typeof CurrentProjectManifestSchema.infer

/** Inferred type for a facet entry in a current manifest (compact or expanded) */
export type ProjectFacetEntry = typeof CurrentFacetEntry.infer

/** Inferred type for an expanded facet entry's materialization overrides */
export type FacetMaterializationOverrides = typeof MaterializationOverrides.infer

/**
 * The source specifier of a facet entry, whichever form it takes.
 *
 * Read-only consumers (`facet list`, drift detection) need the source and
 * nothing else; routing them through this accessor means a new entry form
 * cannot silently degrade them to rendering `[object Object]`.
 */
export function facetEntrySource(entry: ProjectFacetEntry): string {
  return typeof entry === 'string' ? entry : entry.source
}

/**
 * The materialization overrides a facet entry declares. A compact entry
 * declares none.
 */
export function facetEntryOverrides(entry: ProjectFacetEntry): FacetMaterializationOverrides | undefined {
  return typeof entry === 'string' ? undefined : entry.materialization
}
