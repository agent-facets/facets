/**
 * Tagged-union identity for a cache slot.
 *
 * Each kind maps to a distinct on-disk slot:
 *
 *   - `registry`: `<name>@<version>/`
 *   - `git`: `<name>@<commit>/` (full commit SHA)
 *   - `local`: `<name>@local-<pathHash>/` (8-char hash of the absolute
 *     path, so two projects pointing at different local paths get
 *     distinct slots)
 *
 * Identities are content-keyed; once written, a slot is immutable from
 * the cache's perspective. The cache is trusted — its contents are never
 * re-hashed on read. Integrity verification happens upstream against the
 * source's lockfile/registry metadata before content lands in the cache.
 */
export type CacheIdentity =
  | { kind: 'registry'; name: string; version: string }
  | { kind: 'git'; name: string; commit: string }
  | { kind: 'local'; name: string; absolutePath: string }
