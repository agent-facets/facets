import { validateAssetName } from '@agent-facets/common'
import { type } from 'arktype'
import { MaterializationDispositionSchema } from './materialization.ts'

/**
 * The legacy alpha lockfile schema version. Numeric `1` identifies ONLY the
 * previous alpha schema (asset entries without per-file integrity records).
 * Version dispatch uses exact equality, never numeric ordering (design D10).
 * When the stable lockfile v1 schema is eventually released, support for
 * this legacy-alpha `1` is removed rather than reinterpreted.
 */
export const LEGACY_LOCKFILE_VERSION = 1

/**
 * The `0.2` lockfile schema: per-materialized-file integrity records, no
 * materialization dispositions. Every asset is understood as materialized
 * under its authored name.
 */
export const LOCKFILE_VERSION_0_2 = 0.2

/**
 * The `0.3` lockfile schema: adds a REQUIRED materialization disposition to
 * every asset so aliased and omitted assets are representable. Authored
 * names, canonical paths, and integrity values are unchanged from `0.2`.
 */
export const LOCKFILE_VERSION_0_3 = 0.3

/**
 * The version a normal install WRITES. Distinct constant from
 * `FACET_ARCHIVE_VERSION` (see ./build-manifest.ts): archive and resolution
 * formats evolve independently (design D10).
 *
 * Deliberately an alias rather than a literal, so the writer version is
 * named once and every write site inherits it.
 *
 * Readers stay broader than the writer ({@link SUPPORTED_LOCKFILE_VERSIONS}),
 * but that is a compatibility property of the format, not a staged rollout:
 * this package, the engine, and the CLI compile into a single artifact from
 * a single commit, so no build can ever contain a `0.3` writer alongside a
 * `0.2`-only reader. Cross-version safety for a teammate on an older CLI
 * comes from that CLI failing closed on an unrecognized version, which is
 * true the moment the format ships.
 */
export const CURRENT_LOCKFILE_VERSION = LOCKFILE_VERSION_0_3

/**
 * Every lockfile schema version this implementation can READ. Broader than
 * what it writes: `0.3` is readable as soon as its schema exists.
 */
export const SUPPORTED_LOCKFILE_VERSIONS: readonly number[] = [
  LEGACY_LOCKFILE_VERSION,
  LOCKFILE_VERSION_0_2,
  LOCKFILE_VERSION_0_3,
]

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
 * The asset-entry rules shared by every version that carries per-file
 * records (`0.2` and `0.3`). Factored out so the two schemas cannot drift:
 * a change to path safety or sort order applies to both by construction.
 *
 * Returns the `ctx.mustBe` message on failure, or `undefined` on success —
 * a message rather than a boolean so each caller reports the specific rule
 * that was violated.
 *
 * Enforces: the shared asset-name guard, at least one file record, path
 * safety for every record, and strict lexicographic ordering by path. The
 * ordering comparison is strict (`>`), so it forbids duplicate paths with
 * the same predicate that keeps lockfile diffs stable.
 */
function checkAssetEntry(name: string, files: ReadonlyArray<{ path: string }>): string | undefined {
  const check = validateAssetName(name)
  if (!check.ok) {
    return `asset name "${name}" ${check.reason}`
  }
  if (files.length === 0) {
    return 'an asset entry with at least one materialized file record'
  }
  for (let i = 0; i < files.length; i++) {
    const record = files[i] as { path: string }
    const pathCheck = validateAssetName(record.path)
    if (!pathCheck.ok) {
      return `file path "${record.path}" ${pathCheck.reason}`
    }
    if (i > 0) {
      const previous = (files[i - 1] as { path: string }).path
      if (!(record.path > previous)) {
        return `file records sorted by path: "${record.path}" must sort after "${previous}" with no duplicates`
      }
    }
  }
  return undefined
}

/**
 * A `0.2` asset entry: adapter-agnostic identity plus a required,
 * deterministically sorted `files` array covering every materialized file —
 * `skills/<name>/SKILL.md` plus declared companions for skills, exactly the
 * conventional primary path for agents and commands. Archive-only
 * supplementary files never appear here (facet-level integrity pins them).
 *
 * Carries no materialization disposition: every `0.2` asset is understood
 * as materialized under its authored name. Dispositions are recognized only
 * in `0.3`.
 */
const Lockfile02Asset = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  files: LockfileAssetFileRecord.array(),
}).narrow((data, ctx) => {
  const error = checkAssetEntry(data.name, data.files)
  return error === undefined ? true : ctx.mustBe(error)
})

/**
 * A `0.3` asset entry: the `0.2` shape plus a REQUIRED materialization
 * disposition.
 *
 * `name` remains the AUTHORED name and `files` remain canonical authored
 * inner-archive paths even when the asset is aliased — those are the
 * identities integrity is anchored to, so aliasing must not perturb them.
 * An omitted asset stays listed with its complete authored file records:
 * the lockfile records the resolved asset set and must be comparable
 * against project intent, so dropping omitted assets would make an omission
 * indistinguishable from a facet that never published the asset. Only the
 * machine-local receipt excludes what is not materialized.
 *
 * The disposition admits all three arms, including `omitted` — unlike the
 * receipt, which admits only the two that put bytes on disk.
 */
const Lockfile03Asset = type({
  scope: "'system' | 'user' | 'project'",
  type: "'skill' | 'agent' | 'command'",
  name: 'string',
  materialization: MaterializationDispositionSchema,
  files: LockfileAssetFileRecord.array(),
}).narrow((data, ctx) => {
  const error = checkAssetEntry(data.name, data.files)
  return error === undefined ? true : ctx.mustBe(error)
})

const Lockfile02FacetEntry = type({
  source: LockfileSource,
  version: LockedVersion,
  integrity: 'string',
  assets: Lockfile02Asset.array(),
})

const Lockfile03FacetEntry = type({
  source: LockfileSource,
  version: LockedVersion,
  integrity: 'string',
  assets: Lockfile03Asset.array(),
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
 * `0.2` lockfile schema: exact numeric `lockfileVersion: 0.2` and
 * per-materialized-file integrity records inside every asset entry. No
 * materialization dispositions — every asset is authored-materialized.
 */
export const Lockfile02Schema = type({
  lockfileVersion: type.unit(LOCKFILE_VERSION_0_2),
  facets: type.Record('string', Lockfile02FacetEntry),
})

/** Inferred TypeScript type for a validated `0.2` lockfile */
export type Lockfile02 = typeof Lockfile02Schema.infer

/** Inferred type for a facet entry inside a `0.2` lockfile */
export type Lockfile02Facet = typeof Lockfile02FacetEntry.infer

/** Inferred type for a `0.2` asset entry with its file-integrity records */
export type Lockfile02AssetEntry = typeof Lockfile02Asset.infer

/**
 * `0.3` lockfile schema: exact numeric `lockfileVersion: 0.3`, the `0.2`
 * per-file integrity records, and a required materialization disposition on
 * every asset.
 */
export const Lockfile03Schema = type({
  lockfileVersion: type.unit(LOCKFILE_VERSION_0_3),
  facets: type.Record('string', Lockfile03FacetEntry),
})

/** Inferred TypeScript type for a validated `0.3` lockfile */
export type Lockfile03 = typeof Lockfile03Schema.infer

/** Inferred type for a facet entry inside a `0.3` lockfile */
export type Lockfile03Facet = typeof Lockfile03FacetEntry.infer

/** Inferred type for a `0.3` asset entry with its materialization disposition */
export type Lockfile03AssetEntry = typeof Lockfile03Asset.infer

/**
 * The schema a normal install WRITES, tracking
 * {@link CURRENT_LOCKFILE_VERSION}. An alias, so the writer cutover is one
 * edit at the constant rather than a rename across every call site.
 */
export const CurrentLockfileSchema = Lockfile03Schema

/** Inferred TypeScript type for a validated current lockfile */
export type CurrentLockfile = typeof CurrentLockfileSchema.infer

/** Inferred type for a facet entry inside a current lockfile */
export type CurrentLockfileFacet = Lockfile03Facet

/** Inferred type for a current asset entry with its materialization disposition */
export type CurrentLockfileAssetEntry = Lockfile03AssetEntry

/** Inferred type for one materialized-file integrity record */
export type LockfileFileRecord = typeof LockfileAssetFileRecord.infer

/** Inferred type for a facet entry inside a legacy alpha (`1`) lockfile */
export type LegacyLockfileFacet = typeof LockfileFacetEntry.infer

/**
 * Inferred type for a legacy alpha (`1`) asset entry: identity only, with
 * neither per-file integrity records nor a materialization disposition.
 */
export type LegacyLockfileAssetEntry = typeof LockfileAsset.infer

/** Inferred type for a locked facet's tagged source provenance */
export type LockfileSource = typeof LockfileSource.infer
