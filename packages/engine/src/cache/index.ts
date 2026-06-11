export { CACHE_INTEGRITY_FILE, type CacheIntegrity, CacheIntegritySchema } from './integrity.ts'
export {
  auditCacheSlot,
  type CacheAuditResult,
  type CacheLookup,
  type CachePutResult,
  type CachePutVerifiedResult,
  type CacheSlotCorruption,
  cacheGet,
  cachePut,
  cachePutVerified,
  cacheSlotIsDir,
  cacheStagingDir,
  computeDirIntegrity,
  type DirIntegrityResult,
  evictCacheSlot,
  readCachedIntegrity,
} from './operations.ts'
export { cachePath, cacheSlot, resolveCacheRoot } from './paths.ts'
export type { CacheIdentity } from './types.ts'
