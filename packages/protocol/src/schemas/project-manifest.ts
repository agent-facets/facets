import { validateAssetName } from '@agent-facets/common'
import { type } from 'arktype'
import { ASSET_DIRECTORY } from '../materialization/identity.ts'
import { ProjectAssetOverrideSchema } from './materialization.ts'
import { validateMcpServerName } from './mcp-server.ts'

// --- Format-version constants (exact dispatch, design D4/D10) ---

/**
 * The first explicit version `facets.json` carried: typed materialization
 * overrides for skills, agents, and commands, and no server group.
 *
 * Frozen. A `0.1` document is validated only by the `0.1` schema, which
 * rejects a `materialization.servers` group outright rather than tolerating
 * it — a project that records server intent has, by definition, written a
 * `0.2` document.
 */
export const PROJECT_MANIFEST_VERSION_0_1 = 0.1

/**
 * The current project-manifest format version: everything `0.1` carried plus
 * the `materialization.servers` override group.
 *
 * It evolves independently of `FACET_ARCHIVE_VERSION`,
 * `CURRENT_LOCKFILE_VERSION`, the receipt version, and the adapter API
 * version — separate compatibility axes that happen to share release trains,
 * not one version in five places. That `0.2` currently coincides with the
 * archive version is a coincidence, not a constraint.
 */
export const CURRENT_PROJECT_MANIFEST_VERSION = 0.2

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
export const SUPPORTED_PROJECT_MANIFEST_VERSIONS: readonly number[] = [
  PROJECT_MANIFEST_VERSION_0_1,
  CURRENT_PROJECT_MANIFEST_VERSION,
]

/**
 * The document key of the MCP server override group.
 *
 * Servers are not an `AssetType`, so this cannot come from `ASSET_DIRECTORY`.
 * Naming it once means the schema, the engine's writer, and the CLI's
 * non-interactive collision report all point users at the same location.
 */
export const SERVER_OVERRIDE_GROUP = 'servers'

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
/** One override group: its document key, its entries, and its key grammar. */
type OverrideGroup = readonly [
  group: string,
  record: Record<string, unknown> | undefined,
  validateKey: (key: string) => { ok: true } | { ok: false; reason: string },
]

/**
 * The rules every version of the override object shares: keys obey their
 * group's grammar, and the object carries at least one override.
 *
 * Shared rather than restated per version so the two schemas can differ in
 * exactly one respect — which groups exist — instead of drifting in the rules
 * that were never meant to change.
 */
function narrowOverrideGroups(groups: readonly OverrideGroup[], ctx: { mustBe: (expected: string) => false }): boolean {
  let total = 0
  for (const [group, record, validateKey] of groups) {
    if (!record) continue
    for (const authoredName of Object.keys(record)) {
      total++
      const check = validateKey(authoredName)
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
}

/**
 * Frozen `0.1` override object. Recognizes the three asset groups and
 * nothing else — a `servers` group in a `0.1` document is rejected by the
 * same `'+': 'reject'` rule that rejects a misspelling, because a project
 * that records server intent has written a `0.2` document by definition.
 */
const MaterializationOverrides01 = type({
  'skills?': type.Record('string', ProjectAssetOverrideSchema),
  'agents?': type.Record('string', ProjectAssetOverrideSchema),
  'commands?': type.Record('string', ProjectAssetOverrideSchema),
  // Arktype tolerates undeclared keys by default, which is right for
  // forward-compatible extension data but wrong here: the group name IS the
  // contribution kind, so `skillz` is not a field we do not understand yet —
  // it is a misspelling of one we do. Accepting it would silently discard the
  // very intent the override exists to record.
  '+': 'reject',
}).narrow((data, ctx) =>
  narrowOverrideGroups(
    [
      [ASSET_DIRECTORY.skill, data.skills, validateAssetName],
      [ASSET_DIRECTORY.agent, data.agents, validateAssetName],
      [ASSET_DIRECTORY.command, data.commands, validateAssetName],
    ],
    ctx,
  ),
)

/**
 * Current (`0.2`) override object: the three asset groups plus `servers`.
 *
 * Server override keys are held to the single-segment declaration grammar
 * rather than the looser path-safety guard the asset groups use. The asset
 * groups are permissive because a project must remain able to address an
 * asset published by an older, more permissive facet format; concrete server
 * declarations have only ever existed under the current grammar, so a key
 * outside it could not name a real server in any supported facet.
 */
const MaterializationOverrides = type({
  'skills?': type.Record('string', ProjectAssetOverrideSchema),
  'agents?': type.Record('string', ProjectAssetOverrideSchema),
  'commands?': type.Record('string', ProjectAssetOverrideSchema),
  'servers?': type.Record('string', ProjectAssetOverrideSchema),
  '+': 'reject',
}).narrow((data, ctx) =>
  narrowOverrideGroups(
    [
      [ASSET_DIRECTORY.skill, data.skills, validateAssetName],
      [ASSET_DIRECTORY.agent, data.agents, validateAssetName],
      [ASSET_DIRECTORY.command, data.commands, validateAssetName],
      [SERVER_OVERRIDE_GROUP, data.servers, validateMcpServerName],
    ],
    ctx,
  ),
)

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

/** Frozen `0.1` expanded entry: same shape, asset-only override groups. */
const ExpandedFacetEntry01 = type({
  source: 'string',
  materialization: MaterializationOverrides01,
})

/**
 * A facet entry under the current schema: the compact source string when the
 * facet needs no overrides (the canonical form), or the expanded object when
 * it does.
 */
const CurrentFacetEntry = type('string').or(ExpandedFacetEntry)

/** A facet entry under the frozen `0.1` schema. */
const FacetEntry01 = type('string').or(ExpandedFacetEntry01)

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
 * Frozen `0.1` project-manifest schema: exact numeric `manifestVersion: 0.1`
 * plus asset-only materialization overrides. Readers keep accepting it; a
 * normal (non-frozen) write migrates the document to the current version.
 */
export const ProjectManifest01Schema = type({
  manifestVersion: type.unit(PROJECT_MANIFEST_VERSION_0_1),
  facets: type.Record('string', FacetEntry01),
})

/**
 * Current (`0.2`) project-manifest schema: exact numeric
 * `manifestVersion: 0.2` plus facet entries that may be compact source
 * strings or expanded entries carrying materialization overrides for assets
 * and MCP servers.
 */
export const CurrentProjectManifestSchema = type({
  manifestVersion: type.unit(CURRENT_PROJECT_MANIFEST_VERSION),
  facets: type.Record('string', CurrentFacetEntry),
})

/** Inferred TypeScript type for a validated `0.1` manifest */
export type ProjectManifest01 = typeof ProjectManifest01Schema.infer

/** Inferred TypeScript type for a validated current (`0.2`) manifest */
export type CurrentProjectManifest = typeof CurrentProjectManifestSchema.infer

/** Inferred type for a facet entry in a current manifest (compact or expanded) */
export type ProjectFacetEntry = typeof CurrentFacetEntry.infer

/** Inferred type for a facet entry in a frozen `0.1` manifest */
export type ProjectFacetEntry01 = typeof FacetEntry01.infer

/** Inferred type for an expanded facet entry's materialization overrides */
export type FacetMaterializationOverrides = typeof MaterializationOverrides.infer

/** Inferred type for a frozen `0.1` entry's materialization overrides */
export type FacetMaterializationOverrides01 = typeof MaterializationOverrides01.infer

/**
 * The source specifier of a facet entry, whichever form it takes.
 *
 * Read-only consumers (`facet list`, drift detection) need the source and
 * nothing else; routing them through this accessor means a new entry form
 * cannot silently degrade them to rendering `[object Object]`.
 */
export function facetEntrySource(entry: ProjectFacetEntry | ProjectFacetEntry01): string {
  return typeof entry === 'string' ? entry : entry.source
}

/**
 * The materialization overrides a facet entry declares. A compact entry
 * declares none.
 */
export function facetEntryOverrides(
  entry: ProjectFacetEntry | ProjectFacetEntry01,
): FacetMaterializationOverrides | undefined {
  return typeof entry === 'string' ? undefined : entry.materialization
}
