import { validateAssetName } from '@agent-facets/common'
import { type } from 'arktype'

/**
 * Current lockfile schema version. Bump on breaking shape changes.
 * Forward-compat migrations key off this field.
 */
export const LOCKFILE_VERSION = 1

/**
 * A single asset contributed by a facet at this resolved version.
 *
 * Adapter-agnostic by design: the installer applies each asset to ALL
 * selected adapters ("same thing per adapter" invariant). No per-adapter
 * fields live here — any future adapter-specific metadata goes in a
 * sibling field on the facet entry, never on the asset.
 *
 * `name` is narrowed with the shared asset-name guard so a crafted
 * facets.lock can't smuggle `..` or backslash segments into adapter I/O
 * paths. Manifest-side names are already guarded in FacetManifestSchema;
 * this closes the symmetric hole for lockfile-side names (which feed
 * `readAsset` / `deleteAsset` when computing drift-proof deletions).
 */
const LockfileAsset = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
}).narrow((data, ctx) => {
  const check = validateAssetName(data.name)
  if (!check.ok) {
    return ctx.mustBe(`asset name "${data.name}" ${check.reason}`)
  }
  return true
})

/**
 * A single resolved facet entry.
 *
 * `ref` and `commit` are git-source only. Local-path sources omit both.
 * `version` and `integrity` are always present (derived from the
 * freshly-built .facet, not trusted from the input).
 */
const LockfileFacetEntry = type({
  source: 'string',
  'ref?': 'string',
  'commit?': 'string',
  version: 'string',
  integrity: 'string',
  assets: LockfileAsset.array(),
})

/**
 * Schema for facets.lock — the adapter-agnostic lockfile recording
 * resolved facet installation state.
 *
 * Drift-proof deletion: OLD asset set comes from `facets[name].assets`;
 * NEW comes from the freshly-extracted artifact's build-manifest;
 * `to-delete` = OLD \ NEW. No separate cache required.
 */
export const LockfileSchema = type({
  lockfileVersion: 'number',
  facets: type.Record('string', LockfileFacetEntry),
})

/** Inferred TypeScript type for a validated lockfile */
export type Lockfile = typeof LockfileSchema.infer

/** Inferred type for a single facet entry inside a lockfile */
export type LockfileFacet = typeof LockfileFacetEntry.infer

/** Inferred type for a single asset entry in the lockfile */
export type LockfileAssetEntry = typeof LockfileAsset.infer
