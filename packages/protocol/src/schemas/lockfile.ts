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
 * A locked facet version. Always written by the install pipeline as
 * exact `M.N.P`. Narrowed at the schema level so a hand-edited or
 * merge-conflicted lockfile fails validation up front, instead of
 * surfacing as a thrown error deep inside the install pipeline's
 * `parseLockedVersion`.
 *
 * No prerelease support: `VersionSpec` (the type `parseLockedVersion`
 * returns) only models `M.N.P`. Aligning the schema with the parser
 * keeps both shapes in sync. Adding prerelease support means widening
 * both — see the open question in the engine-side parser.
 */
const LOCKED_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/
const LockedVersion = type('string').narrow(
  (s, ctx) => LOCKED_VERSION_RE.test(s) || ctx.mustBe('an exact M.N.P version string'),
)

/**
 * A locked git commit SHA. Narrowed so a commitless or non-SHA git source
 * can't satisfy the schema — the commit is the immutable identity that makes
 * a git install reproducible (see `LockfileSource`). Lowercase hex, at least
 * 8 characters, with no upper bound: this admits abbreviated SHAs, full
 * SHA-1 (40 chars), and SHA-256 (64 chars) without a special case. The
 * install pipeline always writes a full `git rev-parse HEAD`; the lower
 * bound only guards against hand-edited or truncated entries.
 */
const LOCKED_COMMIT_RE = /^[0-9a-f]{8,}$/
const LockedCommit = type('string').narrow(
  (s, ctx) => LOCKED_COMMIT_RE.test(s) || ctx.mustBe('a lowercase hex commit SHA (at least 8 characters)'),
)

/**
 * Tagged source provenance for a locked facet entry. One variant per
 * source kind; each carries only the provenance fields meaningful for
 * that kind, so an illegal cross-kind combination is unrepresentable.
 *
 *   - `registry`: the registry origin (base URL) the artifact was
 *     resolved from. Carries NO version specifier — the entry's
 *     `version` field is the resolved identity and the facet name is
 *     the map key, so there is no slot for an unresolved spec
 *     (`latest`, `1.*`) to leak into.
 *   - `git`: the repository URL plus the REQUIRED resolved commit SHA.
 *     The commit is the immutable identity that makes the install
 *     reproducible — a git entry without one is not reproducible and is
 *     therefore not representable. The symbolic ref (`#main`, a tag) is
 *     deliberately NOT recorded: a ref is what the user *requested*
 *     (a manifest concern, and mutable), whereas the lockfile records
 *     what was *resolved*.
 *   - `local`: the resolved path.
 *
 * Expressed with `.or()` (the schema-layer idiom in this package) over
 * three inline object literals discriminated by `kind`.
 */
const LockfileSource = type({ kind: "'registry'", registry: 'string' })
  .or({ kind: "'git'", url: 'string', commit: LockedCommit })
  .or({ kind: "'local'", path: 'string' })

/**
 * A single resolved facet entry.
 *
 * `source` is a tagged provenance value (see `LockfileSource`); git
 * provenance, including the resolved commit, lives inside that value —
 * there are no top-level `ref`/`commit` fields. `version` and
 * `integrity` are always present (derived from the freshly-built
 * .facet, not trusted from the input).
 */
const LockfileFacetEntry = type({
  source: LockfileSource,
  version: LockedVersion,
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

/** Inferred type for a locked facet's tagged source provenance */
export type LockfileSource = typeof LockfileSource.infer

/** Inferred type for a single asset entry in the lockfile */
export type LockfileAssetEntry = typeof LockfileAsset.infer
