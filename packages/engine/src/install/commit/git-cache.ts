import type { SupportedLockfileFacet } from '@agent-facets/protocol'
import { auditCacheSlot, type CacheIdentity, cacheGet, evictCacheSlot, readCachedIntegrity } from '../../cache/index.ts'
import type { OnLog, RunInstallFailure } from '../types.ts'

/**
 * Outcome of an audited git cache lookup.
 *
 *   - `hit` → the slot passed its self-audit AND the audited integrity
 *     equals the locked integrity; `slotPath` is safe to use.
 *   - `miss` → no usable slot (absent, evicted after a failed audit,
 *     or sidecar missing). The caller clones.
 *   - `mismatch` → the slot audited clean but contradicts the lockfile
 *     (a coordinated bytes+sidecar rewrite). Hard failure.
 */
export type GitCacheLookup =
  | { kind: 'hit'; slotPath: string }
  | { kind: 'miss' }
  | { kind: 'mismatch'; failure: RunInstallFailure }

/**
 * Cache-first lookup for a locked git facet, with the D4 self-audit:
 * the slot's content is re-hashed against its integrity sidecar via
 * `auditCacheSlot` — never trusted on the sidecar's say-so. A failed
 * audit (tampered bytes, missing/invalid sidecar) evicts the slot and
 * degrades to a miss (re-clone).
 */
export function auditedGitCacheLookup(
  facetName: string,
  effectiveLocked: SupportedLockfileFacet,
  onLog: OnLog,
): GitCacheLookup {
  const cacheId: CacheIdentity = { kind: 'git', name: facetName, version: effectiveLocked.version }
  const lookup = cacheGet(cacheId)
  if (!lookup.hit) return { kind: 'miss' }

  const sidecar = readCachedIntegrity(lookup.path)
  if (sidecar === null) {
    // Missing/invalid sidecar — the slot cannot be audited, so it
    // cannot be used. Evict and re-clone (soft miss).
    evictCacheSlot(lookup.path)
    onLog(() => `[verbose]   cache slot ${lookup.path} has no valid integrity sidecar; evicted, recloning`)
    return { kind: 'miss' }
  }

  const audit = auditCacheSlot(lookup.path, sidecar)
  if (!audit.ok) {
    evictCacheSlot(lookup.path)
    onLog(() => `[verbose]   cache slot ${lookup.path} failed its self-audit; evicted, recloning`)
    return { kind: 'miss' }
  }

  if (audit.integrity !== effectiveLocked.integrity) {
    // Audited content disagrees with the lockfile. The lockfile is the
    // source of truth; surface as a hard error rather than silently
    // refetching.
    return {
      kind: 'mismatch',
      failure: {
        code: 'CACHE_INTEGRITY_MISMATCH',
        facet: facetName,
        slotPath: lookup.path,
        cachedIntegrity: audit.integrity,
        lockedIntegrity: effectiveLocked.integrity,
      },
    }
  }

  onLog(() => `[verbose]   cache hit ${lookup.path} (audited)`)
  return { kind: 'hit', slotPath: lookup.path }
}
