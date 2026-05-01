import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CacheIdentity } from './types.ts'

/**
 * Default cache root: `~/.facets/cache/`.
 *
 * Computed lazily from `homedir()` so test harnesses can override
 * `HOME` (or set `FACETS_CACHE_DIR`) without import-order surprises.
 */
function defaultCacheRoot(): string {
  return join(homedir(), '.facets', 'cache')
}

/**
 * Resolve the cache root directory.
 *
 * Override precedence (matches the `FACETS_ADAPTERS_DIR` pattern in
 * `placement.ts` — read on every call so per-test subprocess overrides
 * work as expected):
 *
 *   1. `FACETS_CACHE_DIR` env var (trimmed; whitespace-only treated as unset).
 *   2. Default: `~/.facets/cache/`.
 */
export function resolveCacheRoot(): string {
  const override = process.env.FACETS_CACHE_DIR?.trim()
  if (override !== undefined && override.length > 0) {
    return override
  }
  return defaultCacheRoot()
}

/**
 * Hash an absolute path into an 8-character lowercase hex digest.
 * Used to disambiguate local-source cache slots without leaking the
 * full path into the cache directory layout.
 */
function hashLocalPath(absolutePath: string): string {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 8)
}

/**
 * Compute the slot name (the directory under the cache root) for a
 * given identity. Pure, sync, no I/O.
 */
export function cacheSlot(identity: CacheIdentity): string {
  switch (identity.kind) {
    case 'registry':
      return `${identity.name}@${identity.version}`
    case 'git':
      return `${identity.name}@${identity.version}`
    case 'local':
      return `${identity.name}@local-${hashLocalPath(identity.absolutePath)}`
  }
}

/**
 * Compute the absolute path to a cache entry. Does not check whether
 * the entry exists.
 */
export function cachePath(identity: CacheIdentity): string {
  return join(resolveCacheRoot(), cacheSlot(identity))
}
