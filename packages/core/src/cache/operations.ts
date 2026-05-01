import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { type } from 'arktype'
import { computeContentHash } from '../build/content-hash.ts'
import type { AssetIntegrityFailure, FacetIntegrityFailure, IntegrityFailure } from '../integrity/types.ts'
import type { BuildManifest } from '../schemas/build-manifest.ts'
import { CACHE_INTEGRITY_FILE, type CacheIntegrity, CacheIntegritySchema } from './integrity.ts'
import { cachePath, resolveCacheRoot } from './paths.ts'
import type { CacheIdentity } from './types.ts'

/**
 * Result of a cache lookup. Discriminated by `hit`.
 */
export type CacheLookup = { hit: true; path: string } | { hit: false; path: string }

/**
 * Information about a corrupted cache slot detected by `cachePut`.
 * Pure data — no `Error` instance, no stack trace.
 *
 * The cache invariant is that every populated slot is a directory of
 * extracted facet content; a non-directory entry indicates corruption
 * (a partial write from a crashed process, manual tampering, or a
 * future bug). Recovery: clear the slot path manually and retry. The
 * lockfile remains the source of truth; corrupted cache slots are
 * always recoverable by eviction + refetch.
 */
export interface CacheSlotCorruption {
  slotPath: string
  entryKind: 'file' | 'symlink' | 'other'
}

/**
 * Result of a `cachePut`. Discriminated by `ok`.
 *
 *   - `ok: true` → atomic rename succeeded; `path` is the slot path.
 *   - `ok: false` → the destination slot exists but is not a directory.
 *     The caller's `sourceDir` is left intact; recovery is to evict
 *     the bad entry (`rm <slotPath>`) and retry, or surface the
 *     corruption upstream.
 */
export type CachePutResult = { ok: true; path: string } | { ok: false; corruption: CacheSlotCorruption }

/**
 * Returns true iff `path` exists on disk and is a directory. Never
 * throws — returns false on ENOENT, EACCES, or any other stat failure.
 * Single source of truth for "does this slot count as a real cache
 * entry"; used by `cacheGet`, `cachePut`, and `cacheSlotIsDir`.
 */
function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Classify a non-directory entry at `path` for `CacheCorruptionError`.
 * Uses `lstatSync` so a symlink is reported as 'symlink' rather than
 * being followed.
 */
function classifyNonDirEntry(path: string): 'file' | 'symlink' | 'other' {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return 'symlink'
    if (stat.isFile()) return 'file'
    return 'other'
  } catch {
    return 'other'
  }
}

/**
 * Look up a cache entry by identity.
 *
 * Returns `{ hit: true, path }` if the entry exists on disk as a
 * directory. Returns `{ hit: false, path }` otherwise — the path is
 * still returned so the caller can use it as the destination for a
 * subsequent `cachePut`. A non-directory entry at the slot path
 * (e.g., a stray file from a crashed process) is treated as a miss.
 *
 * The cache is trusted: a cache hit is taken at face value and is NOT
 * re-hashed against the originating source's integrity declarations.
 * Integrity verification happens upstream, before content lands here.
 */
export function cacheGet(identity: CacheIdentity): CacheLookup {
  const path = cachePath(identity)
  if (isExistingDirectory(path)) {
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
 * as a directory at rename time (another writer won the race), we treat
 * the existing entry as authoritative — the cache invariant says cached
 * content is trusted — and the loser's `sourceDir` is removed so we
 * don't leak disk. The function returns `{ ok: true; path }` either way.
 *
 * Corruption resolution: if the destination slot exists but is not a
 * directory (a stray file, symlink, or other entry from a crashed
 * process or manual tampering), `cachePut` returns
 * `{ ok: false, corruption }` and leaves `sourceDir` intact so the
 * caller can retry or inspect. Silently overwriting would mask
 * poisoning; the lockfile is the source of truth, so cache corruption
 * is always recoverable by manual eviction.
 *
 * The caller is responsible for ensuring `sourceDir` is on the same
 * filesystem as the cache root. If the cache lives on a different
 * device than the system tmp dir, the caller should `mkdtemp` under
 * the cache root (see `cacheStagingDir`) rather than the OS tmp dir.
 *
 * `cachePut` only throws for genuinely unexpected environment failures
 * (e.g., a `renameSync` error that isn't EEXIST — out of disk, FS
 * unmount mid-operation, permission denied at a layer outside our
 * contract). In-contract failure modes go through the result type.
 */
export function cachePut(identity: CacheIdentity, sourceDir: string): CachePutResult {
  const finalPath = cachePath(identity)
  const root = resolveCacheRoot()
  mkdirSync(root, { recursive: true })

  if (existsSync(finalPath)) {
    if (!isExistingDirectory(finalPath)) {
      return {
        ok: false,
        corruption: { slotPath: finalPath, entryKind: classifyNonDirEntry(finalPath) },
      }
    }
    // Another writer got there first (or this is an idempotent re-put).
    // Trust the existing entry; clean up our staging.
    rmSync(sourceDir, { recursive: true, force: true })
    return { ok: true, path: finalPath }
  }

  try {
    renameSync(sourceDir, finalPath)
  } catch (error) {
    // EEXIST: a concurrent writer raced us between our existsSync and
    // renameSync. Same resolution: trust the existing entry IF it's a
    // directory; otherwise it's corruption.
    if (existsSync(finalPath)) {
      if (!isExistingDirectory(finalPath)) {
        return {
          ok: false,
          corruption: { slotPath: finalPath, entryKind: classifyNonDirEntry(finalPath) },
        }
      }
      rmSync(sourceDir, { recursive: true, force: true })
      return { ok: true, path: finalPath }
    }
    throw error
  }

  return { ok: true, path: finalPath }
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
  return isExistingDirectory(cachePath(identity))
}

/**
 * Result of `cachePutVerified`. Discriminated by `ok`; the failure
 * side has two sub-shapes:
 *
 *   - `corruption` → cache slot is corrupted (non-directory squatter);
 *     same shape as `cachePut`'s corruption arm.
 *   - `integrity` → audit failed; either an asset's hash didn't match
 *     the build manifest's recorded hash (`AssetIntegrityFailure`) or
 *     the caller's `computedIntegrity` disagreed with the manifest's
 *     recorded `integrity` (`FacetIntegrityFailure` with `check: 'C'`).
 *     Cache slot was NOT created; sourceDir is intact.
 */
export type CachePutVerifiedResult =
  | { ok: true; path: string }
  | { ok: false; corruption: CacheSlotCorruption }
  | { ok: false; integrity: IntegrityFailure }

/**
 * Atomically commit a verified directory of facet content to the cache.
 *
 * Performs two integrity checks before writing:
 *
 *   1. **Per-asset audit**: for every `(path, expectedHash)` in
 *      `buildManifest.assets`, read the file from `sourceDir`,
 *      recompute SHA-256 via `computeContentHash`, compare. Any
 *      mismatch returns an `AssetIntegrityFailure` with the offending
 *      path. A missing or unreadable asset is reported with
 *      `observed: '<missing>'`.
 *
 *   2. **Top-level compare**: `computedIntegrity` (the caller's
 *      verified hash of the canonical archive bytes) must equal
 *      `buildManifest.integrity` (the manifest's self-declared top-
 *      level integrity). Mismatch returns a `FacetIntegrityFailure`
 *      with `check: 'C'`. This is the same logical check as the
 *      registry three-check protocol's check C, applied at cache-
 *      write time across all source kinds.
 *
 * The function never recomputes the top-level integrity itself —
 * that's the caller's responsibility because the source bytes vary
 * by source kind:
 *   - **registry**: hash the downloaded archive bytes directly.
 *   - **git/local**: use `buildResult.integrity` from the build
 *     pipeline (which hashes the canonical tar of the cloned/local
 *     source tree).
 *
 * On audit pass:
 *   3. Write `cache-integrity.json` (stripped sidecar) into
 *      `sourceDir`.
 *   4. Delegate to `cachePut(identity, sourceDir)`. Forward result.
 *
 * On audit fail: returns failure result, leaves `sourceDir` intact,
 * does NOT touch the cache. The lockfile remains the source of truth.
 *
 * Like `cachePut`, only throws for genuinely unexpected environment
 * failures (sidecar write fails for a reason other than the audit;
 * `cachePut`'s rename throws something other than EEXIST). Per-asset
 * read failures during the audit are converted to `'<missing>'`
 * results inside the function.
 */
export function cachePutVerified(
  identity: CacheIdentity,
  sourceDir: string,
  buildManifest: BuildManifest,
  computedIntegrity: string,
  facet: string,
): CachePutVerifiedResult {
  // 1. Per-asset audit.
  for (const [path, expected] of Object.entries(buildManifest.assets)) {
    let observed: string
    try {
      const bytes = readFileSync(join(sourceDir, path))
      observed = computeContentHash(bytes)
    } catch {
      const failure: AssetIntegrityFailure = {
        kind: 'asset',
        facet,
        path,
        expected,
        observed: '<missing>',
      }
      return { ok: false, integrity: failure }
    }
    if (observed !== expected) {
      const failure: AssetIntegrityFailure = {
        kind: 'asset',
        facet,
        path,
        expected,
        observed,
      }
      return { ok: false, integrity: failure }
    }
  }

  // 2. Top-level: caller-computed integrity vs. manifest's claim.
  if (computedIntegrity !== buildManifest.integrity) {
    const failure: FacetIntegrityFailure = {
      kind: 'facet',
      facet,
      check: 'C',
      expected: buildManifest.integrity,
      observed: computedIntegrity,
    }
    return { ok: false, integrity: failure }
  }

  // 3. Write the stripped sidecar.
  const sidecar: CacheIntegrity = {
    integrity: computedIntegrity,
    assets: buildManifest.assets,
  }
  writeFileSync(join(sourceDir, CACHE_INTEGRITY_FILE), JSON.stringify(sidecar, null, 2))

  // 4. Delegate to cachePut.
  const putResult = cachePut(identity, sourceDir)
  if (!putResult.ok) {
    return { ok: false, corruption: putResult.corruption }
  }
  return { ok: true, path: putResult.path }
}

/**
 * Read the cache slot's integrity sidecar. Returns the parsed
 * `CacheIntegrity` on success, or `null` if the sidecar is missing,
 * unreadable, or fails schema validation. A `null` return means
 * "treat as cache miss" — the install pipeline will refetch.
 *
 * Never throws.
 */
export function readCachedIntegrity(slotPath: string): CacheIntegrity | null {
  const file = join(slotPath, CACHE_INTEGRITY_FILE)
  if (!existsSync(file)) return null
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const validated = CacheIntegritySchema(parsed)
  if (validated instanceof type.errors) return null
  return validated as CacheIntegrity
}
