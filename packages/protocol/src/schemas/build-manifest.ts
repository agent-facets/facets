import { type } from 'arktype'

// --- Archive-format constants ---

/**
 * The current archive format version written into every new build manifest.
 * Distinct from `CURRENT_LOCKFILE_VERSION` (see ./lockfile.ts): archive and
 * resolution formats carry independent version axes and may evolve
 * separately, even when their numbers happen to coincide (design D10).
 */
export const FACET_ARCHIVE_VERSION = 0.2

/** The legacy archive format version, accepted as consumer input during the compatibility window. */
export const LEGACY_FACET_ARCHIVE_VERSION = 0.1

/** Every archive format version this implementation can verify. */
export const SUPPORTED_FACET_VERSIONS: readonly number[] = [LEGACY_FACET_ARCHIVE_VERSION, FACET_ARCHIVE_VERSION]

/**
 * Outer-tar layout constants. Defined here (with the schemas that pin them)
 * and re-exported from `../build/content-hash.ts`, which consumes them for
 * assembly/parsing — a single source for the wire contract without an
 * import cycle.
 */
/** Fixed name of the inner compressed archive inside the outer tar. */
export const INNER_ARCHIVE_NAME = 'archive.tar.gz'
/** Fixed name of the build manifest inside the outer tar. */
export const BUILD_MANIFEST_NAME = 'build-manifest.json'

const INTEGRITY_RE = /^sha256:[a-f0-9]{64}$/

// --- Versioned schemas (exact facetVersion dispatch, design D4) ---

/**
 * Legacy `0.1` build-manifest schema — frozen at the pre-supplementary-file
 * shape: a per-asset `assets` hash map. `facetVersion` is pinned to the
 * exact numeric literal `0.1`; a `files` key is rejected so the two format
 * shapes are unrepresentable in one validated document.
 */
export const LegacyBuildManifestSchema = type({
  facetVersion: type.unit(LEGACY_FACET_ARCHIVE_VERSION),
  archive: 'string',
  integrity: INTEGRITY_RE,
  assets: type.Record('string', 'string'),
}).narrow((data, ctx) => {
  if (Object.hasOwn(data, 'files')) {
    return ctx.mustBe('a legacy 0.1 build manifest without a current-format "files" map')
  }
  return true
})

/** Inferred TypeScript type for a validated legacy (`0.1`) build manifest */
export type LegacyBuildManifest = typeof LegacyBuildManifestSchema.infer

/**
 * Current `0.2` build-manifest schema. `facetVersion` is pinned to the exact
 * numeric literal `0.2` and `archive` to the exact canonical entry name, so
 * producers and consumers cannot disagree about which outer-tar entry is
 * authoritative. The `files` map carries one `sha256:<hex>` hash per
 * canonical inner-archive path — hashes only; entry classification is NEVER
 * read from the build manifest, it is derived from the embedded `facet.json`
 * via the archive plan (design D3/D4). A legacy `assets` key is rejected.
 */
export const CurrentBuildManifestSchema = type({
  facetVersion: type.unit(FACET_ARCHIVE_VERSION),
  archive: type.unit(INNER_ARCHIVE_NAME),
  integrity: INTEGRITY_RE,
  files: type.Record('string', type(INTEGRITY_RE)),
}).narrow((data, ctx) => {
  if (Object.hasOwn(data, 'assets')) {
    return ctx.mustBe('a current 0.2 build manifest without a legacy "assets" map')
  }
  return true
})

/** Inferred TypeScript type for a validated current (`0.2`) build manifest */
export type CurrentBuildManifest = typeof CurrentBuildManifestSchema.infer

// --- Transitional permissive schema ---

/**
 * Schema for the build manifest (build-manifest.json), written by
 * `facet build` alongside the .facet archive.
 *
 * @deprecated Transitional: this permissive shape (unpinned `facetVersion`,
 * legacy `assets` map) predates exact version dispatch. Verification and
 * engine call sites migrate to `parseBuildManifestDocument` /
 * `LegacyBuildManifestSchema` / `CurrentBuildManifestSchema` during the
 * consumer-bridge and producer blocks of the `0.2` rollout, after which this
 * export is removed.
 */
export const BuildManifestSchema = type({
  facetVersion: 'number',
  archive: 'string',
  integrity: INTEGRITY_RE,
  assets: type.Record('string', 'string'),
})

/** Inferred TypeScript type for a validated build manifest */
export type BuildManifest = typeof BuildManifestSchema.infer
