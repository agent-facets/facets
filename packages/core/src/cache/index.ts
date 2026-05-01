export { CACHE_INTEGRITY_FILE, type CacheIntegrity, CacheIntegritySchema } from './integrity.ts'
export {
  type CacheLookup,
  type CachePutResult,
  type CachePutVerifiedResult,
  type CacheSlotCorruption,
  cacheGet,
  cachePut,
  cachePutVerified,
  cacheSlotIsDir,
  cacheStagingDir,
  readCachedIntegrity,
} from './operations.ts'
export { cachePath, cacheSlot, resolveCacheRoot } from './paths.ts'
export type { CacheIdentity } from './types.ts'
