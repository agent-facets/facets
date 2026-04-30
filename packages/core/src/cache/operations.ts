import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cachePath, resolveCacheRoot } from './paths.ts'
import type { CacheIdentity } from './types.ts'

/**
 * Result of a cache lookup. Discriminated by `hit`.
 */
export type CacheLookup = { hit: true; path: string } | { hit: false; path: string }

/**
 * Look up a cache entry by identity.
 *
 * Returns `{ hit: true, path }` if the entry exists on disk as a
 * directory. Returns `{ hit: false, path }` otherwise — the path is
 * still returned so the caller can use it as the destination for a
 * subsequent `cachePut`.
 *
 * The cache is trusted: a cache hit is taken at face value and is NOT
 * re-hashed against the originating source's integrity declarations.
 * Integrity verification happens upstream, before content lands here.
 */
export function cacheGet(identity: CacheIdentity): CacheLookup {
  const path = cachePath(identity)
  if (existsSync(path)) {
    return { hit: true, path }
  }
  return { hit: false, path }
}

/**
 * Atomically commit a directory of content to the cache slot for an
 * identity.
 *
 * Two-phase write:
 *   1. The caller has populated `sourceDir` with the verified content.
 *   2. `cachePut` `mkdir -p`s the cache root, then `renameSync`s
 *      `sourceDir` to its final slot. The rename is atomic on POSIX
 *      filesystems when source and destination are on the same device.
 *
 * Concurrent-write resolution: if the destination slot already exists
 * at rename time (another writer won the race), we treat the existing
 * entry as authoritative — the cache invariant says cached content is
 * trusted — and the loser's `sourceDir` is removed so we don't leak
 * disk. The function returns the final slot path either way.
 *
 * The caller is responsible for ensuring `sourceDir` is on the same
 * filesystem as the cache root. If the cache lives on a different
 * device than the system tmp dir, the caller should `mkdtemp` under
 * the cache root (see `cacheStagingDir`) rather than the OS tmp dir.
 */
export function cachePut(identity: CacheIdentity, sourceDir: string): string {
  const finalPath = cachePath(identity)
  const root = resolveCacheRoot()
  mkdirSync(root, { recursive: true })

  if (existsSync(finalPath)) {
    // Another writer got there first (or this is an idempotent re-put).
    // Trust the existing entry; clean up our staging.
    rmSync(sourceDir, { recursive: true, force: true })
    return finalPath
  }

  try {
    renameSync(sourceDir, finalPath)
  } catch (error) {
    // EEXIST: a concurrent writer raced us between our existsSync and
    // renameSync. Same resolution: trust the existing entry.
    if (existsSync(finalPath)) {
      rmSync(sourceDir, { recursive: true, force: true })
      return finalPath
    }
    throw error
  }

  return finalPath
}

/**
 * Create a fresh staging directory under the cache root, suitable as
 * the `sourceDir` argument to `cachePut`. Using this guarantees the
 * staging dir lives on the same filesystem as the eventual cache
 * slot, so the final `renameSync` is atomic and never falls back to
 * a copy.
 *
 * Caller is responsible for cleaning up the staging dir if `cachePut`
 * is never invoked.
 */
export function cacheStagingDir(): string {
  const root = resolveCacheRoot()
  const stagingRoot = join(root, '.staging')
  mkdirSync(stagingRoot, { recursive: true })
  return mkdtempSync(join(stagingRoot, 'put-'))
}

/**
 * Confirm the cache slot for a given identity is a directory on disk.
 * Used by tests and diagnostics. Returns false for missing or non-dir
 * paths. Never throws.
 */
export function cacheSlotIsDir(identity: CacheIdentity): boolean {
  const path = cachePath(identity)
  if (!existsSync(path)) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
