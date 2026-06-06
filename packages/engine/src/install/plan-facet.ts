import { rm } from 'node:fs/promises'
import type { Adapter } from '@agent-facets/adapter'
import type { BuildManifest, Lockfile, LockfileFacet, ResolvedFacetManifest } from '@agent-facets/protocol'
import { satisfies, verifyGitOneCheck } from '@agent-facets/protocol'
import { runBuildPipeline } from '../build/pipeline.ts'
import { type CacheIdentity, cacheGet, cachePutVerified, cacheStagingDir, readCachedIntegrity } from '../cache/index.ts'
import { loadManifest, resolvePrompts } from '../loaders/facet.ts'
import { downloadAndExtractFacet } from '../registry/download.ts'
import { resolveRegistryMetadataBatch } from '../registry/resolve-metadata.ts'
import { parseFacetSource } from '../sources/facet/parse-source.ts'
import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { cloneFacetGitSource } from '../sources/facet/resolve-git.ts'
import { resolveLocalFacetSource } from '../sources/facet/resolve-local.ts'
import { cloneFailureToRunInstall } from './clone-failure.ts'
import { computeAssetList } from './materialize.ts'
import { parseLockedVersion } from './parse-locked-version.ts'
import { resolveCloneRef } from './resolve-clone-ref.ts'
import type { RunInstallFailure, StageEvent } from './types.ts'

/**
 * Per-facet plan: parse → resolve → load → build → return entry.
 *
 * Wraps the entire flow in a try/finally that always cleans up the
 * cloned git directory, even if a downstream step fails.
 */
export interface PlanFacetArgs {
  facetName: string
  specifier: string
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  previousLockfile: Lockfile
  onStage: (event: StageEvent) => void
  onLog: (line: string) => void
}

export interface PlanFacetSuccess {
  entry: LockfileFacet
  resolved: ResolvedFacetManifest
  serversDeclared: ReadonlyArray<string>
}

export type PlanFacetResult = { ok: true; value: PlanFacetSuccess } | { ok: false; failure: RunInstallFailure }

export async function planFacet(args: PlanFacetArgs): Promise<PlanFacetResult> {
  const { facetName, specifier, projectRoot, previousLockfile, onStage, onLog } = args

  // Parse the source specifier.
  //
  // The manifest is a `name → value` map. For a registry source the value
  // is a bare version specifier (`1.2.3`, `1.*`, `*`, `latest`) and the
  // facet name lives in the KEY — so when the value parses as a bare
  // VersionSpec we reconstruct the full source as `${facetName}@${value}`.
  // For git/local sources the value is a self-contained source string
  // (URL, `file:` path) and the key is just a label; we parse the value
  // standalone. This keeps `facets.json` values semver-shaped for registry
  // entries (the value the user sees is `1.2.3`, not `cowsay@1.2.3`) while
  // still round-tripping through source resolution.
  onStage({ kind: 'facet-stage', facet: facetName, stage: 'parse' })
  const sourceString = parseVersionSpec(specifier).ok ? `${facetName}@${specifier}` : specifier
  const parsed = parseFacetSource(sourceString)
  if (!parsed.ok) {
    return {
      ok: false,
      failure: { code: 'PARSE_ERROR', facet: facetName, specifier, error: parsed.error },
    }
  }

  let sourceDir: string | undefined
  let cleanup: (() => Promise<void>) | undefined
  // Captured by the clone path; consumed when constructing a fresh-add
  // lockfile entry. Locked entries inherit ref/commit from `locked`.
  let clonedRef: string | undefined
  let clonedCommit: string | undefined
  // `locked` is the committed lockfile entry for this facet, if any.
  // When defined, it's the security contract: the install MUST reproduce
  // exactly these bytes (or fail loudly). Cache hits short-circuit when
  // the sidecar matches `locked.integrity`.
  const locked = previousLockfile.facets[facetName]
  // A registry lock is stale when its version no longer satisfies the
  // manifest spec (hand-edit / pull / merge). Only registry sources carry
  // a VersionSpec; git is ref-based and local is mutable, so neither
  // is ever stale here. A stale entry is treated as absent below so the
  // facet re-resolves like a fresh add, overwriting the stale entry.
  const isStale =
    locked !== undefined &&
    parsed.value.kind === 'registry' &&
    !satisfies(parseLockedVersion(locked.version), parsed.value.version)
  const effectiveLocked = isStale ? undefined : locked
  // Set when a cache hit's sidecar matches the locked integrity. The
  // sidecar IS the post-write trust certificate; we don't rebuild to
  // re-derive what the cache already proved at write time.
  let trustedCacheHit = false

  // Resolve to a sourceDir.
  onStage({ kind: 'facet-stage', facet: facetName, stage: 'resolve' })
  if (parsed.value.kind === 'git') {
    // Cache-first when we have a locked entry: name + version are both
    // known from `locked`, so we can look up the cache slot without any
    // clone or network round-trip.
    if (locked !== undefined) {
      const cacheId: CacheIdentity = {
        kind: 'git',
        name: facetName,
        version: locked.version,
      }
      const lookup = cacheGet(cacheId)
      if (lookup.hit) {
        const cached = readCachedIntegrity(lookup.path)
        if (cached === null) {
          // Sidecar missing/invalid — incomplete cache slot. Treat as
          // soft miss and fall through to clone.
          onLog(`[verbose]   cache slot ${lookup.path} has no valid integrity sidecar; refetching`)
        } else if (cached.integrity !== locked.integrity) {
          // Cache disagrees with lockfile. Lockfile is the source of
          // truth; surface as hard error rather than silently refetching.
          return {
            ok: false,
            failure: {
              code: 'CACHE_INTEGRITY_MISMATCH',
              facet: facetName,
              slotPath: lookup.path,
              cachedIntegrity: cached.integrity,
              lockedIntegrity: locked.integrity,
            },
          }
        } else {
          // Cache hit + sidecar matches lockfile. The sidecar is the
          // post-write trust certificate; we trust it without rebuilding.
          // No clone, no build pipeline, no rehashing.
          sourceDir = lookup.path
          trustedCacheHit = true
          // No cleanup — cache entries are durable.
          onLog(`[verbose]   cache hit ${lookup.path}`)
        }
      }
    }

    // Cache miss (or no locked entry, or sidecar invalid). Clone.
    if (sourceDir === undefined) {
      const cloneRef = resolveCloneRef(locked, parsed.value.ref)
      const cloned = await cloneFacetGitSource(parsed.value.url, cloneRef)
      if (!cloned.ok) {
        return {
          ok: false,
          failure: cloneFailureToRunInstall(facetName, cloned),
        }
      }
      sourceDir = cloned.dir
      cleanup = async () => {
        await rm(cloned.dir, { recursive: true, force: true }).catch(() => {})
      }
      clonedRef = cloneRef
      clonedCommit = cloned.commit
      onLog(`[verbose]   cloned ${parsed.value.url} → ${sourceDir} (sha: ${cloned.commit ?? '?'})`)
    }
  } else if (parsed.value.kind === 'local') {
    const local = await resolveLocalFacetSource(parsed.value.path, projectRoot)
    if (!local.ok) {
      return {
        ok: false,
        failure: { code: 'LOCAL_RESOLVE_FAILED', facet: facetName, cause: local.error },
      }
    }
    sourceDir = local.dir
  } else {
    // Registry source. Cache-first when locked AND satisfying; otherwise
    // resolve metadata → download archive → extract to temp dir → let the
    // build pipeline re-derive integrity (the cache write below moves temp
    // → cache slot).
    if (effectiveLocked !== undefined) {
      const cacheId: CacheIdentity = {
        kind: 'registry',
        name: facetName,
        version: effectiveLocked.version,
      }
      const lookup = cacheGet(cacheId)
      if (lookup.hit) {
        const cached = readCachedIntegrity(lookup.path)
        if (cached === null) {
          onLog(`[verbose]   cache slot ${lookup.path} has no valid integrity sidecar; refetching`)
        } else if (cached.integrity !== effectiveLocked.integrity) {
          return {
            ok: false,
            failure: {
              code: 'CACHE_INTEGRITY_MISMATCH',
              facet: facetName,
              slotPath: lookup.path,
              cachedIntegrity: cached.integrity,
              lockedIntegrity: effectiveLocked.integrity,
            },
          }
        } else {
          sourceDir = lookup.path
          trustedCacheHit = true
          onLog(`[verbose]   cache hit ${lookup.path}`)
        }
      }
    }

    if (sourceDir === undefined) {
      onStage({ kind: 'facet-stage', facet: facetName, stage: 'fetch' })
      // Reproducibility: when a satisfying lockfile entry pins a version,
      // resolve metadata for THAT exact version on a cache miss — never
      // re-resolve from the manifest specifier (which may be `@latest` or a
      // wildcard). Without this, a cold-cache reinstall of a project locked
      // to `1.2.3` against a manifest of `@latest` would silently fetch
      // `1.3.0` and trip the integrity check. Mirrors `resolveCloneRef` for
      // the git path.
      const versionForFetch: typeof parsed.value.version =
        effectiveLocked !== undefined ? parseLockedVersion(effectiveLocked.version) : parsed.value.version
      const metaResult = await resolveRegistryMetadataBatch([{ name: parsed.value.name, version: versionForFetch }])
      if (!metaResult.ok) {
        return { ok: false, failure: { code: 'REGISTRY_ERROR', facet: facetName, error: metaResult.error } }
      }
      const meta = metaResult.value[0]
      if (meta === undefined) {
        return {
          ok: false,
          failure: {
            code: 'REGISTRY_ERROR',
            facet: facetName,
            error: {
              code: 'NETWORK_ERROR',
              cause: 'registry returned no metadata for the requested facet',
              attempts: 1,
            },
          },
        }
      }

      // Stage under the cache root (not the OS tmp dir). cachePutVerified's
      // final rename into the cache slot must be atomic, which requires the
      // staging dir and the slot to share a filesystem. If FACET_DIR
      // points at a volume different from /tmp, mkdtemp under tmpdir() would
      // make the rename throw EXDEV.
      const tempDir = cacheStagingDir()
      onStage({ kind: 'facet-stage', facet: facetName, stage: 'verify' })
      const downloadResult = await downloadAndExtractFacet(meta, tempDir)
      if (!downloadResult.ok) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
        return { ok: false, failure: { code: 'REGISTRY_ERROR', facet: facetName, error: downloadResult.error } }
      }
      sourceDir = tempDir
      cleanup = async () => {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
      onLog(`[verbose]   downloaded ${meta.name}@${meta.version} → ${sourceDir}`)
    }
  }

  try {
    // Load and validate the facet.json.
    onStage({ kind: 'facet-stage', facet: facetName, stage: 'load' })
    const rawManifest = await loadManifest(sourceDir)
    if (!rawManifest.ok) {
      return {
        ok: false,
        failure: { code: 'MANIFEST_LOAD_FAILED', facet: facetName, errors: rawManifest.errors },
      }
    }
    if (rawManifest.data.name !== facetName) {
      return {
        ok: false,
        failure: {
          code: 'MANIFEST_NAME_MISMATCH',
          facet: facetName,
          manifestName: rawManifest.data.name,
        },
      }
    }
    if (rawManifest.data.facets && rawManifest.data.facets.length > 0) {
      return { ok: false, failure: { code: 'COMPOSITION_REJECTED', facet: facetName } }
    }

    const serversDeclared = rawManifest.data.servers ? Object.keys(rawManifest.data.servers) : []

    // Resolve prompts (loads actual prompt content from disk). Always
    // runs — `materialize` reads prompt bodies from the resolved
    // manifest, so this is needed on both the trusted-cache-hit path
    // and the build path.
    const resolved = await resolvePrompts(rawManifest.data, sourceDir)
    if (!resolved.ok) {
      return {
        ok: false,
        failure: { code: 'BUILD_FAILED', facet: facetName, errors: resolved.errors },
      }
    }

    let entry: LockfileFacet
    if (trustedCacheHit && effectiveLocked !== undefined) {
      // Trusted cache hit: sidecar already certified the integrity at write
      // time. Skip the build pipeline entirely and inherit the locked entry
      // verbatim. A stale entry never reaches here — it never sets
      // `trustedCacheHit`.
      entry = {
        source: specifier,
        ...(effectiveLocked.ref !== undefined ? { ref: effectiveLocked.ref } : {}),
        ...(effectiveLocked.commit !== undefined ? { commit: effectiveLocked.commit } : {}),
        version: effectiveLocked.version,
        integrity: effectiveLocked.integrity,
        assets: effectiveLocked.assets,
      }
    } else {
      // Build path: cache miss, soft miss, or local source.
      onStage({ kind: 'facet-stage', facet: facetName, stage: 'build' })
      const buildResult = await runBuildPipeline(sourceDir, [...args.adapters])
      if (!buildResult.ok) {
        return {
          ok: false,
          failure: { code: 'BUILD_FAILED', facet: facetName, errors: buildResult.errors },
        }
      }

      // Tag-move guard: if this is a LOCKED GIT source, the just-built
      // integrity MUST match the locked integrity. The lockfile is the
      // security contract; the network-served artifact has been modified
      // since we locked it if these disagree. Refuse the install — do
      // NOT cache, do NOT write the lockfile, do NOT materialize.
      //
      // Local sources are intentionally exempt: filesystem-backed
      // sources are mutable by definition (the user edits them), so
      // an integrity drift is expected, not an attack. The lockfile
      // entry's integrity gets overwritten by the new build for local
      // sources. See `verifyGitOneCheck` docstring for the rationale.
      // Tag-move guard: a satisfying locked git/registry entry MUST
      // reproduce its locked integrity (the lockfile is the security
      // contract). A stale entry is being discarded, so it has no locked
      // integrity to reproduce — the guard is skipped and the fresh
      // download is verified by the registry three-check instead.
      if (effectiveLocked !== undefined && (parsed.value.kind === 'git' || parsed.value.kind === 'registry')) {
        const guard = verifyGitOneCheck({
          facet: facetName,
          computedIntegrity: buildResult.integrity,
          lockfileIntegrity: effectiveLocked.integrity,
        })
        if (!guard.ok) {
          return { ok: false, failure: { code: 'INTEGRITY_FAILURE', failure: guard.failure } }
        }
      }

      // Fresh git clone or fresh registry download → audit-then-write to
      // cache. Cache hits already have content in the slot; local sources
      // skip the cache entirely.
      if (cleanup !== undefined && (parsed.value.kind === 'git' || parsed.value.kind === 'registry')) {
        const buildManifest = JSON.parse(buildResult.manifestJson) as BuildManifest
        const cacheId: CacheIdentity =
          parsed.value.kind === 'git'
            ? { kind: 'git', name: facetName, version: buildResult.data.version }
            : { kind: 'registry', name: facetName, version: buildResult.data.version }
        const putResult = cachePutVerified(cacheId, sourceDir, buildManifest, buildResult.integrity, facetName)
        if (!putResult.ok) {
          if ('corruption' in putResult) {
            return {
              ok: false,
              failure: {
                code: 'CACHE_INTEGRITY_MISMATCH',
                facet: facetName,
                slotPath: putResult.corruption.slotPath,
                cachedIntegrity: '<corrupt>',
                lockedIntegrity: buildResult.integrity,
              },
            }
          }
          return { ok: false, failure: { code: 'INTEGRITY_FAILURE', failure: putResult.integrity } }
        }
        sourceDir = putResult.path
        cleanup = undefined
      }

      // Construct the entry.
      //
      //   - Satisfying GIT/REGISTRY entries inherit locked.* verbatim (we
      //     just verified buildResult matches, so values are equal — but the
      //     lockfile is the source of truth and we never rewrite it).
      //   - Stale registry entries (`effectiveLocked === undefined`) fall
      //     into the build-derived branch below, overwriting the
      //     contradictory entry with the freshly resolved version/integrity.
      //   - Local sources (locked or fresh) derive from the build.
      //     Local is mutable by design; the user owns the version and
      //     content, and the lockfile follows what's on disk.
      //   - Fresh git adds derive from the build + the clone's commit.
      //   - Fresh registry adds derive from the build (no ref/commit).
      if (effectiveLocked !== undefined && (parsed.value.kind === 'git' || parsed.value.kind === 'registry')) {
        entry = {
          source: specifier,
          ...(effectiveLocked.ref !== undefined ? { ref: effectiveLocked.ref } : {}),
          ...(effectiveLocked.commit !== undefined ? { commit: effectiveLocked.commit } : {}),
          version: effectiveLocked.version,
          integrity: effectiveLocked.integrity,
          assets: effectiveLocked.assets,
        }
      } else {
        const newAssets = computeAssetList(resolved.data)
        entry = {
          source: specifier,
          ...(clonedRef !== undefined ? { ref: clonedRef } : {}),
          ...(clonedCommit !== undefined ? { commit: clonedCommit } : {}),
          version: buildResult.data.version,
          integrity: buildResult.integrity,
          assets: newAssets,
        }
      }
    }

    return { ok: true, value: { entry, resolved: resolved.data, serversDeclared } }
  } finally {
    if (cleanup) await cleanup()
  }
}
