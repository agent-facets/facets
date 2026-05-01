/**
 * Tagged-union identity for a cache slot.
 *
 * Each kind maps to a distinct on-disk slot:
 *
 *   - `registry`: `<name>@<version>/`
 *   - `git`: `<name>@<version>/` (version from the cloned facet's
 *     `facet.json`; same invariant as registry: one name@version, one
 *     integrity)
 *   - `local`: `<name>@local-<pathHash>/` (8-char hash of the absolute
 *     path, so two projects pointing at different local paths get
 *     distinct slots)
 *
 * The cache key is `(name, version)` for both registry and git so that
 * lockfile-driven re-installs can look up the cache without any clone
 * or network round-trip. Commit provenance for git sources lives in
 * the lockfile entry's `commit` field, never in the cache key. This
 * avoids the chicken-and-egg of needing the commit to find the cache
 * slot but needing to clone to learn the commit.
 *
 * Identities are content-keyed; once written, a slot is durable from
 * the cache's perspective. The cache is verified at write time via
 * the build manifest's per-asset hashes, then trusted at read time
 * via a single top-level integrity comparison against the lockfile.
 */
export type CacheIdentity =
  | { kind: 'registry'; name: string; version: string }
  | { kind: 'git'; name: string; version: string }
  | { kind: 'local'; name: string; absolutePath: string }
