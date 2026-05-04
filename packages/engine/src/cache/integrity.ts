import { type } from 'arktype'

/**
 * Filename of the cache integrity sidecar inside every populated cache
 * slot. Carries the integrity-bearing fields stripped from the build
 * manifest at write time.
 */
export const CACHE_INTEGRITY_FILE = 'cache-integrity.json'

/**
 * The cache-integrity sidecar.
 *
 *   - `integrity`: top-level hash over the canonical archive bytes.
 *     Compared against the lockfile on every install (fast path).
 *   - `assets`: per-asset hash table. Available for an out-of-band
 *     deep-validate command (e.g. a future `facet cache verify`) but
 *     NOT consulted on install.
 *
 * Derived from the build manifest at `cachePutVerified` time. The
 * `facetVersion` and `archive` fields of the build manifest are
 * dropped because they're meaningless post-extraction (the cache slot
 * IS the extracted content).
 */
export const CacheIntegritySchema = type({
  integrity: /^sha256:[a-f0-9]{64}$/,
  assets: type.Record('string', /^sha256:[a-f0-9]{64}$/),
})

export type CacheIntegrity = typeof CacheIntegritySchema.infer
