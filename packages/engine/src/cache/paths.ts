import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { facetCacheDir } from '../facet-dir.ts'
import type { CacheIdentity } from './types.ts'

/**
 * Resolve the cache root directory: `$FACET_DIR/cache/`.
 *
 * Delegates to `facetCacheDir()` (the single source of truth for the
 * facet directory tree). No per-subsystem env var — `FACET_DIR` is the
 * one override.
 */
export function resolveCacheRoot(): string {
  return facetCacheDir()
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
