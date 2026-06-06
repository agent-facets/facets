import { rm } from 'node:fs/promises'
import type { Adapter } from '@agent-facets/adapter'
import type {
  BuildManifest,
  Lockfile,
  LockfileFacet,
  LockfileSource,
  ResolvedFacetManifest,
} from '@agent-facets/protocol'
import { satisfies, verifyGitOneCheck, verifyLockfileOneCheck } from '@agent-facets/protocol'
import { runBuildPipeline } from '../build/pipeline.ts'
import { type CacheIdentity, cacheGet, cachePutVerified, cacheStagingDir, readCachedIntegrity } from '../cache/index.ts'
import { loadManifest, resolvePrompts } from '../loaders/facet.ts'
import { downloadAndExtractFacet } from '../registry/download.ts'
import { getRegistryBaseUrl } from '../registry/http.ts'
import { resolveRegistryMetadataBatch } from '../registry/resolve-metadata.ts'
import { parseFacetSource } from '../sources/facet/parse-source.ts'
import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { cloneFacetGitSource } from '../sources/facet/resolve-git.ts'
import { resolveLocalFacetSource } from '../sources/facet/resolve-local.ts'
import type { Source } from '../sources/facet/types.ts'
import { cloneFailureToRunInstall } from './clone-failure.ts'
import { computeAssetList } from './materialize.ts'
import { parseLockedVersion } from './parse-locked-version.ts'
import { resolveCloneRef } from './resolve-clone-ref.ts'
import { sourceMatchesLockedSource } from './source-matches.ts'
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
  /**
   * Frozen-lockfile mode. When true, a locked entry MUST reproduce its
   * locked integrity for EVERY source kind — including local sources,
   * which are otherwise mutable and rebuilt from disk. A mismatch fails
   * the install with `INTEGRITY_FAILURE`; the entry is never rewritten.
   */
  frozenLockfile?: boolean
}

export interface PlanFacetSuccess {
  entry: LockfileFacet
  resolved: ResolvedFacetManifest
  serversDeclared: ReadonlyArray<string>
}

export type PlanFacetResult = { ok: true; value: PlanFacetSuccess } | { ok: false; failure: RunInstallFailure }

/**
 * Decide whether a lockfile entry still applies to the manifest source.
 *
 * Pure function — exported for unit testing. When it returns `undefined`,
 * the caller treats the entry like a fresh add: no cache lookup by the old
 * version, no clone at the old commit, and no integrity check against bytes
 * from the old source.
 */
export function resolveEffectiveLockedForPlan(
  locked: LockfileFacet | undefined,
  source: Source,
): LockfileFacet | undefined {
  // A registry lock is stale when its version no longer satisfies the
  // manifest spec (hand-edit / pull / merge). A git lock is stale when
  // the parsed manifest source no longer matches the locked source; the
  // old commit/integrity belong to the old origin and must not constrain
  // the new clone.
  //
  // Local entries are intentionally not stale here. Non-frozen local
  // installs rebuild from disk and overwrite the entry; frozen installs
  // reject source drift in the preflight before planning.
  const isRegistryStale =
    locked !== undefined && source.kind === 'registry' && !satisfies(parseLockedVersion(locked.version), source.version)
  // The locked git source is a tagged value. Compare canonical (post-parse)
  // URLs so a manifest shorthand (`github:owner/repo`, a `#ref` suffix)
  // matches the provenance a fresh install wrote — never the raw specifier
  // text. A locked entry that is not a git source can never match a git
  // manifest source.
  const isGitSourceChanged =
    locked !== undefined && source.kind === 'git' && !sourceMatchesLockedSource(source, locked.source)

  return isRegistryStale || isGitSourceChanged ? undefined : locked
}

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
  // git lockfile source. Locked entries inherit their source from `locked`.
  // The ref is not recorded in the lockfile (it's a manifest concern); only
  // the resolved commit is pinned.
  let clonedCommit: string | undefined
  // `locked` is the committed lockfile entry for this facet, if any.
  // When defined, it's the security contract: the install MUST reproduce
  // exactly these bytes (or fail loudly). Cache hits short-circuit when
  // the sidecar matches `locked.integrity`.
  const locked = previousLockfile.facets[facetName]
  // A stale entry is treated as absent below so the facet re-resolves like
  // a fresh add, overwriting the stale entry.
  const effectiveLocked = resolveEffectiveLockedForPlan(locked, parsed.value)
  // Set when a cache hit's sidecar matches the locked integrity. The
  // sidecar IS the post-write trust certificate; we don't rebuild to
  // re-derive what the cache already proved at write time.
  let trustedCacheHit = false

  // Resolve to a sourceDir.
  onStage({ kind: 'facet-stage', facet: facetName, stage: 'resolve' })
  if (parsed.value.kind === 'git') {
    // Cache-first when we have an effective locked entry: name + version are
    // both known from `effectiveLocked`, so we can look up the cache slot
    // without any clone or network round-trip.
    //
    // Bypass the cache entirely when the manifest source no longer matches
    // `locked.source` (a swapped URL or ref). The cache slot is keyed on
    // {name, version} and carries no source provenance, so a cache hit would
    // serve bytes that may belong to a different origin. Skipping the lookup
    // here falls through to cloning the manifest's current URL. (In frozen
    // mode the preflight already rejected this as `source-changed`; this guard
    // makes the cache correct for non-frozen installs too — a changed URL
    // re-resolves from the new source instead of silently reusing old bytes.)
    if (effectiveLocked !== undefined) {
      const cacheId: CacheIdentity = {
        kind: 'git',
        name: facetName,
        version: effectiveLocked.version,
      }
      const lookup = cacheGet(cacheId)
      if (lookup.hit) {
        const cached = readCachedIntegrity(lookup.path)
        if (cached === null) {
          // Sidecar missing/invalid — incomplete cache slot. Treat as
          // soft miss and fall through to clone.
          onLog(`[verbose]   cache slot ${lookup.path} has no valid integrity sidecar; refetching`)
        } else if (cached.integrity !== effectiveLocked.integrity) {
          // Cache disagrees with lockfile. Lockfile is the source of
          // truth; surface as hard error rather than silently refetching.
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
      const cloneRef = resolveCloneRef(effectiveLocked, parsed.value.ref)
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
      clonedCommit = cloned.commit
      onLog(`[verbose]   cloned ${parsed.value.url} → ${sourceDir} (sha: ${cloned.commit})`)
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
        source: effectiveLocked.source,
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

      // Integrity reproduction guard: a satisfying locked entry MUST
      // reproduce its locked integrity, or the install fails — do NOT
      // cache, do NOT write the lockfile, do NOT materialize.
      //
      //   - GIT/REGISTRY (always): the lockfile is the security contract;
      //     a network-served artifact that no longer hashes to the locked
      //     integrity has been modified since we locked it (a tag move).
      //   - LOCAL (frozen only): filesystem sources are mutable by design,
      //     so a normal install rebuilds and overwrites the entry. But
      //     `--frozen-lockfile` promises bit-for-bit reproduction of the
      //     lockfile, so a frozen install treats local exactly like git:
      //     the edited local content must still hash to the locked
      //     integrity, or the install blows up.
      //
      // A stale entry (`effectiveLocked === undefined`) is being discarded,
      // so it has no locked integrity to reproduce — the guard is skipped
      // and the fresh download is verified by the registry three-check.
      const mustReproduceIntegrity =
        effectiveLocked !== undefined &&
        (parsed.value.kind === 'git' ||
          parsed.value.kind === 'registry' ||
          (parsed.value.kind === 'local' && args.frozenLockfile === true))
      if (mustReproduceIntegrity) {
        // Pick the verifier by source kind so the reported `check` honestly
        // names what diverged. A git tag-move is `check: 'git'`; everything
        // else reaching this guard (frozen LOCAL drift, or a cache-miss
        // registry rebuild) is a built-vs-lockfile divergence → `'lockfile'`.
        // Both verifiers run the same hash equality; only the label differs.
        const verifyReproduction = parsed.value.kind === 'git' ? verifyGitOneCheck : verifyLockfileOneCheck
        const guard = verifyReproduction({
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
      //   - Entries that just reproduced their locked integrity
      //     (`mustReproduceIntegrity`) inherit locked.* verbatim — we
      //     verified buildResult matches, and the lockfile is the source of
      //     truth, so we never rewrite it. This now includes frozen LOCAL
      //     sources: frozen never rewrites a local entry.
      //   - Stale registry entries (`effectiveLocked === undefined`) fall
      //     into the build-derived branch below, overwriting the
      //     contradictory entry with the freshly resolved version/integrity.
      //   - Non-frozen LOCAL sources derive from the build. Local is mutable
      //     by design; the user owns the version and content, and the
      //     lockfile follows what's on disk.
      //   - Fresh git adds derive from the build + the clone's commit.
      //   - Fresh registry adds derive from the build (registry origin only).
      if (mustReproduceIntegrity) {
        entry = {
          source: effectiveLocked.source,
          version: effectiveLocked.version,
          integrity: effectiveLocked.integrity,
          assets: effectiveLocked.assets,
        }
      } else {
        const newAssets = computeAssetList(resolved.data)
        const buildSource = buildLockfileSource(facetName, parsed.value, clonedCommit)
        if (!buildSource.ok) {
          return { ok: false, failure: buildSource.failure }
        }
        entry = {
          source: buildSource.source,
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

/**
 * Build the tagged lockfile `source` for a freshly-resolved (build-derived)
 * entry from the parsed source and, for git, the resolved clone commit.
 *
 *   - registry → the registry origin (base URL) this run resolved against.
 *     The version is recorded in the entry's `version` field, never here.
 *   - git → the repository URL plus the required resolved commit. The
 *     commit is guaranteed by the clone contract on the build-derived
 *     path; a missing one is a programmer error and fails the install
 *     rather than writing a commitless (non-reproducible) entry.
 *   - local → the resolved path.
 */
function buildLockfileSource(
  facetName: string,
  source: Source,
  clonedCommit: string | undefined,
): { ok: true; source: LockfileSource } | { ok: false; failure: RunInstallFailure } {
  switch (source.kind) {
    case 'registry':
      return { ok: true, source: { kind: 'registry', registry: getRegistryBaseUrl() } }
    case 'git':
      if (clonedCommit === undefined) {
        return {
          ok: false,
          failure: { code: 'GIT_COMMIT_UNRESOLVED', facet: facetName, url: source.url, stderr: '' },
        }
      }
      return { ok: true, source: { kind: 'git', url: source.url, commit: clonedCommit } }
    case 'local':
      return { ok: true, source: { kind: 'local', path: source.path } }
  }
}
