import { validateAssetName } from '@agent-facets/common'
import { type } from 'arktype'

/**
 * The legacy alpha lockfile schema version. Numeric `1` identifies ONLY the
 * previous alpha schema (asset entries without per-file integrity records).
 * Version dispatch uses exact equality, never numeric ordering (design D10).
 * When the stable lockfile v1 schema is eventually released, support for
 * this legacy-alpha `1` is removed rather than reinterpreted.
 */
export const LEGACY_LOCKFILE_VERSION = 1

/**
 * The current lockfile schema version. Distinct constant from
 * `FACET_ARCHIVE_VERSION` (see ./build-manifest.ts): both currently equal
 * `0.2`, but that is release alignment, not a permanent invariant — archive
 * and resolution formats may evolve independently (design D10).
 */
export const CURRENT_LOCKFILE_VERSION = 0.2

/** Every lockfile schema version this implementation can read. */
export const SUPPORTED_LOCKFILE_VERSIONS: readonly number[] = [LEGACY_LOCKFILE_VERSION, CURRENT_LOCKFILE_VERSION]

/**
 * Current lockfile schema version. Bump on breaking shape changes.
 * Forward-compat migrations key off this field.
 *
 * @deprecated Transitional: engine's pre-`0.2` loader still keys its
 * newer-version guard and empty-lockfile bootstrap off this constant. It
 * migrates to exact dispatch via `parseLockfileDocument` (with
 * `LEGACY_LOCKFILE_VERSION` / `CURRENT_LOCKFILE_VERSION`) in the lockfile
 * migration block of the `0.2` rollout, after which this export is removed.
 */
export const LOCKFILE_VERSION = LEGACY_LOCKFILE_VERSION

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

// --- Current (0.2) asset shape: per-materialized-file integrity records ---

const FILE_INTEGRITY_RE = /^sha256:[a-f0-9]{64}$/

/**
 * One materialized-file integrity record inside its owning asset entry
 * (design D10). `path` is the canonical inner-archive path; `integrity` is
 * the hash of that archive entry's exact canonical bytes. Companion files
 * are subordinate records here — they never become independent assets.
 */
const LockfileAssetFileRecord = type({
  path: 'string',
  integrity: FILE_INTEGRITY_RE,
})

/**
 * A current (`0.2`) asset entry: adapter-agnostic identity plus a required,
 * deterministically sorted `files` array covering every materialized file —
 * `skills/<name>/SKILL.md` plus declared companions for skills, exactly the
 * conventional primary path for agents and commands. Archive-only
 * supplementary files never appear here (facet-level integrity pins them).
 *
 * The narrow enforces: the shared asset-name guard (as in the legacy asset
 * shape), path safety for every file record, and strict lexicographic
 * ordering by path (which also forbids duplicate paths) so lockfile diffs
 * stay stable and reviewable.
 */
const CurrentLockfileAsset = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  files: LockfileAssetFileRecord.array(),
}).narrow((data, ctx) => {
  const check = validateAssetName(data.name)
  if (!check.ok) {
    return ctx.mustBe(`asset name "${data.name}" ${check.reason}`)
  }
  if (data.files.length === 0) {
    return ctx.mustBe('an asset entry with at least one materialized file record')
  }
  for (let i = 0; i < data.files.length; i++) {
    const record = data.files[i] as (typeof data.files)[number]
    const pathCheck = validateAssetName(record.path)
    if (!pathCheck.ok) {
      return ctx.mustBe(`file path "${record.path}" ${pathCheck.reason}`)
    }
    if (i > 0) {
      const previous = (data.files[i - 1] as (typeof data.files)[number]).path
      if (!(record.path > previous)) {
        return ctx.mustBe(
          `file records sorted by path: "${record.path}" must sort after "${previous}" with no duplicates`,
        )
      }
    }
  }
  return true
})

const CurrentLockfileFacetEntry = type({
  source: LockfileSource,
  version: LockedVersion,
  integrity: 'string',
  assets: CurrentLockfileAsset.array(),
})

// --- Versioned lockfile schemas (exact version dispatch, design D10) ---

/**
 * Legacy alpha (`1`) lockfile schema — the previous alpha shape with
 * asset entries carrying identity only, pinned to exact numeric
 * `lockfileVersion: 1`. Read-only during the compatibility window; normal
 * installs migrate it to `0.2`, frozen installs retain it without rewriting.
 */
export const LegacyLockfileSchema = type({
  lockfileVersion: type.unit(LEGACY_LOCKFILE_VERSION),
  facets: type.Record('string', LockfileFacetEntry),
})

/** Inferred TypeScript type for a validated legacy (`1`) lockfile */
export type LegacyLockfile = typeof LegacyLockfileSchema.infer

/**
 * Current (`0.2`) lockfile schema: exact numeric `lockfileVersion: 0.2` and
 * per-materialized-file integrity records inside every asset entry.
 */
export const CurrentLockfileSchema = type({
  lockfileVersion: type.unit(CURRENT_LOCKFILE_VERSION),
  facets: type.Record('string', CurrentLockfileFacetEntry),
})

/** Inferred TypeScript type for a validated current (`0.2`) lockfile */
export type CurrentLockfile = typeof CurrentLockfileSchema.infer

/** Inferred type for a current facet entry inside a `0.2` lockfile */
export type CurrentLockfileFacet = typeof CurrentLockfileFacetEntry.infer

/** Inferred type for a current asset entry with its file-integrity records */
export type CurrentLockfileAssetEntry = typeof CurrentLockfileAsset.infer

/** Inferred type for one materialized-file integrity record */
export type LockfileFileRecord = typeof LockfileAssetFileRecord.infer

/**
 * Schema for facets.lock — the adapter-agnostic lockfile recording
 * resolved facet installation state.
 *
 * Drift-proof deletion: OLD asset set comes from `facets[name].assets`;
 * NEW comes from the freshly-extracted artifact's build-manifest;
 * `to-delete` = OLD \ NEW. No separate cache required.
 *
 * @deprecated Transitional: this permissive shape (unpinned
 * `lockfileVersion`, identity-only assets) predates exact version dispatch.
 * Engine's loader migrates to `parseLockfileDocument` /
 * `LegacyLockfileSchema` / `CurrentLockfileSchema` in the lockfile
 * migration block of the `0.2` rollout, after which this export is removed.
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
