import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { runBuildPipeline } from '../build/pipeline.ts'
import { type CacheIdentity, cacheGet, cachePutVerified, readCachedIntegrity } from '../cache/index.ts'
import { verifyGitOneCheck } from '../integrity/index.ts'
import { loadManifest, type ResolvedFacetManifest, resolvePrompts } from '../loaders/facet.ts'
import { loadFacetsJson } from '../manifest/project-files.ts'
import type { BuildManifest } from '../schemas/build-manifest.ts'
import type { Lockfile, LockfileFacet } from '../schemas/lockfile.ts'
import type { FacetsJson } from '../schemas/project-manifest.ts'
import { parseFacetSource } from '../sources/facet/parse-source.ts'
import { cloneFacetGitSource } from '../sources/facet/resolve-git.ts'
import { resolveLocalFacetSource } from '../sources/facet/resolve-local.ts'
import { InstallJournal } from './journal.ts'
import { acquireInstallLock } from './lockfile-guard.ts'
import { emptyLockfile, FACETS_LOCK_FILE, loadLockfile, writeLockfile } from './lockfile-io.ts'
import { computeAssetList, materialize } from './materialize.ts'
import type {
  FacetOutcome,
  InstallSummary,
  RunInstallFailure,
  RunInstallOptions,
  RunInstallResult,
  StageEvent,
} from './types.ts'

/**
 * Resolve which git commitish to clone for a facet on a cache miss.
 *
 * Reproducibility: when the lockfile pins a commit, clone exactly that
 * commit — never the manifest ref. The manifest ref can move (`#main`,
 * mutable tags); the locked commit cannot. Without this, a cache-miss
 * reinstall of a locked entry pointing at `#main` would silently pull
 * whatever main points to today, then either fail integrity
 * verification (frustrating) or rewrite the lockfile (worse — a silent
 * reproducibility break). Fresh adds (no `locked` entry) fall back to
 * the manifest ref.
 *
 * Pure function — exported for unit testing.
 */
export function resolveCloneRef(
  locked: LockfileFacet | undefined,
  manifestRef: string | undefined,
): string | undefined {
  return locked?.commit ?? manifestRef
}

/**
 * Run the install pipeline for a project.
 *
 * Behavior is uniform across all callers (add, install, future TUI):
 *
 *   - For each facet declared in `facets.json`, honor the lockfile
 *     entry's pinned version if one exists; otherwise resolve fresh
 *     from the manifest specifier (bun-style bootstrap).
 *   - Drift removal: any facet in the prior lockfile that's no longer
 *     in `facets.json` has its assets removed.
 *   - Always materialize, always write the lockfile.
 *
 * The "lockfile honored verbatim" property gives reproducible installs
 * across machines without `facet update` having to exist yet. When real
 * registry I/O lands, locked entries fetch their pinned version, while
 * newly-added manifest entries resolve their range.
 *
 * Always returns; never throws. Failures are reported via
 * `result.failure`; rollback status via `result.rollback`.
 */
export async function runInstall(opts: RunInstallOptions): Promise<RunInstallResult> {
  const { projectRoot, adapters, signal } = opts
  const onStage = opts.onStage ?? noopStage
  const onLog = opts.onLog ?? noopLog

  // 1. Load facets.json.
  const facetsJsonResult = loadFacetsJson(projectRoot)
  if (!facetsJsonResult.ok) {
    return failureWithoutRollback({
      code: 'FACETS_JSON_INVALID',
      path: join(projectRoot, 'facets.json'),
      error: facetsJsonResult.error,
    })
  }
  if (!facetsJsonResult.existed) {
    return failureWithoutRollback({
      code: 'FACETS_JSON_NOT_FOUND',
      path: join(projectRoot, 'facets.json'),
    })
  }
  const facetsJson = facetsJsonResult.data

  // 2. Acquire install lock.
  const lockResult = acquireInstallLock(projectRoot)
  if (!lockResult.ok) {
    return failureWithoutRollback({
      code: 'LOCK_HELD',
      path: lockResult.path,
      heldByPid: lockResult.heldByPid,
    })
  }
  const installLock = lockResult.lock

  const journal = new InstallJournal()

  try {
    // 3. Load existing lockfile (or skeleton).
    const lockfileResult = loadLockfile(projectRoot)
    if (!lockfileResult.ok) {
      return failureNoMutation({
        code: 'LOCKFILE_INVALID',
        path: join(projectRoot, FACETS_LOCK_FILE),
        error: lockfileResult.error,
      })
    }
    const previousLockfile = lockfileResult.existed ? lockfileResult.data : emptyLockfile()

    onStage({
      kind: 'install-start',
      totalFacets: Object.keys(facetsJson.facets).length,
    })

    // 5. Per-facet install loop.
    const newFacetEntries: Record<string, LockfileFacet> = {}
    const perFacet: FacetOutcome[] = []
    const serverWarnings: { facet: string; servers: ReadonlyArray<string> }[] = []
    let totalAssets = 0
    let removedAssets = 0
    let installed = 0
    let updated = 0
    let repaired = 0
    let unchanged = 0
    let removed = 0

    for (const [facetName, specifier] of Object.entries(facetsJson.facets)) {
      if (signal?.aborted) {
        return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
      }
      onStage({ kind: 'facet-start', facet: facetName, specifier })

      const planResult = await planFacet({
        facetName,
        specifier,
        projectRoot,
        adapters,
        previousLockfile,
        onStage,
        onLog,
      })
      if (!planResult.ok) {
        onStage({ kind: 'facet-failure', facet: facetName, failure: planResult.failure })
        return await rollbackAndFail(journal, planResult.failure, onLog)
      }

      const { entry, resolved, serversDeclared } = planResult.value

      if (serversDeclared.length > 0) {
        serverWarnings.push({ facet: facetName, servers: serversDeclared })
        onStage({ kind: 'server-warning', facet: facetName, servers: serversDeclared })
      }

      // Materialize.
      const previousEntry = previousLockfile.facets[facetName]
      const oldAssets = previousEntry?.assets ?? []

      onStage({ kind: 'facet-stage', facet: facetName, stage: 'materialize' })
      let materializeResult: { written: number; skipped: number; deleted: number }
      try {
        materializeResult = await materialize({
          manifest: resolved,
          adapters: [...adapters],
          oldAssets,
          newAssets: entry.assets,
          journal,
          onLog,
        })
      } catch (error) {
        const failure: RunInstallFailure = {
          code: 'ADAPTER_INSTALL_FAILED',
          facet: facetName,
          adapter: 'unknown',
          cause: error instanceof Error ? error.message : String(error),
        }
        onStage({ kind: 'facet-failure', facet: facetName, failure })
        return await rollbackAndFail(journal, failure, onLog)
      }

      newFacetEntries[facetName] = entry
      // Count only assets actually written (skipped no-ops don't count).
      totalAssets += materializeResult.written

      // Classify outcome — `repaired` means same lockfile entry but at
      // least one asset needed to be re-written on disk.
      const outcome = classifyOutcome(facetName, previousEntry, entry, materializeResult.written)
      perFacet.push(outcome)
      if (outcome.kind === 'installed') installed++
      else if (outcome.kind === 'updated') updated++
      else if (outcome.kind === 'repaired') repaired++
      else if (outcome.kind === 'unchanged') unchanged++

      onStage({ kind: 'facet-success', facet: facetName, outcome })
    }

    // 6. Drift removal: facets in old lockfile but not in current facets.json.
    for (const [facetName, prevEntry] of Object.entries(previousLockfile.facets)) {
      if (signal?.aborted) {
        return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
      }
      if (facetsJson.facets[facetName] !== undefined) continue

      onStage({ kind: 'drift-removal', facet: facetName, oldVersion: prevEntry.version })
      try {
        await materialize({
          manifest: removalManifest(facetName),
          adapters: [...adapters],
          oldAssets: prevEntry.assets,
          newAssets: [],
          journal,
          onLog,
        })
      } catch (error) {
        const failure: RunInstallFailure = {
          code: 'ADAPTER_INSTALL_FAILED',
          facet: facetName,
          adapter: 'unknown',
          cause: error instanceof Error ? error.message : String(error),
        }
        return await rollbackAndFail(journal, failure, onLog)
      }
      removedAssets += prevEntry.assets.length * adapters.length
      removed++
      perFacet.push({ kind: 'removed', name: facetName, oldVersion: prevEntry.version })
    }

    if (signal?.aborted) {
      return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
    }

    // 7. Write lockfile.
    //
    // Wrapped in try/catch because `writeLockfile` performs disk I/O
    // (EACCES on a read-only fs, ENOSPC on disk-full, EIO on hardware
    // faults). An unprotected throw here would exit `runInstall` via
    // exception after assets are already materialized — breaking both
    // the "always returns" contract AND leaving the project in an
    // inconsistent state (assets written, lockfile not updated). Route
    // through `rollbackAndFail` so the journal undoes the materialize
    // and the caller gets a structured `LOCKFILE_WRITE_FAILED` result.
    const newLockfile: Lockfile = {
      lockfileVersion: previousLockfile.lockfileVersion,
      facets: newFacetEntries,
    }
    try {
      writeLockfile(projectRoot, newLockfile)
    } catch (error) {
      return await rollbackAndFail(
        journal,
        {
          code: 'LOCKFILE_WRITE_FAILED',
          path: join(projectRoot, FACETS_LOCK_FILE),
          cause: error instanceof Error ? error.message : String(error),
        },
        onLog,
      )
    }
    onStage({ kind: 'lockfile-write', path: join(projectRoot, FACETS_LOCK_FILE) })

    const summary: InstallSummary = {
      installed,
      updated,
      repaired,
      unchanged,
      removed,
      totalAssets,
      removedAssets,
    }

    onStage({ kind: 'install-complete', outcome: 'success' })

    return {
      ok: true,
      lockfile: newLockfile,
      summary,
      perFacet,
      serverWarnings,
    }
  } finally {
    await installLock.release()
  }

  function noopStage(_event: StageEvent): void {}
  function noopLog(_line: string): void {}

  /**
   * Failure path that runs before the install lock has been released
   * but after no journal entries have been recorded. No rollback is
   * needed because no disk state has been mutated.
   */
  async function failureNoMutation(failure: RunInstallFailure): Promise<RunInstallResult> {
    onStage({ kind: 'install-complete', outcome: 'failure' })
    return { ok: false, failure, rollback: { ok: true } }
  }

  /**
   * Failure path that runs before the install lock has even been
   * acquired (e.g., facets.json missing). Same as `failureNoMutation`
   * but skips the lock release in `finally` because no lock was taken.
   */
  function failureWithoutRollback(failure: RunInstallFailure): RunInstallResult {
    onStage({ kind: 'install-complete', outcome: 'failure' })
    return { ok: false, failure, rollback: { ok: true } }
  }
}

/**
 * Roll back the journal and return the failure. Called whenever a
 * mutation has been recorded and we need to undo it.
 */
async function rollbackAndFail(
  journal: InstallJournal,
  failure: RunInstallFailure,
  onLog: (line: string) => void,
): Promise<RunInstallResult> {
  const rollback = await journal.rollback({ onLog })
  return {
    ok: false,
    failure,
    rollback: rollback.ok ? { ok: true } : { ok: false, partialFailures: rollback.failures },
  }
}

/**
 * Per-facet plan: parse → resolve → load → build → return entry.
 *
 * Wraps the entire flow in a try/finally that always cleans up the
 * cloned git directory, even if a downstream step fails.
 */
interface PlanFacetArgs {
  facetName: string
  specifier: string
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  previousLockfile: Lockfile
  onStage: (event: StageEvent) => void
  onLog: (line: string) => void
}

interface PlanFacetSuccess {
  entry: LockfileFacet
  resolved: ResolvedFacetManifest
  serversDeclared: ReadonlyArray<string>
}

type PlanFacetResult = { ok: true; value: PlanFacetSuccess } | { ok: false; failure: RunInstallFailure }

async function planFacet(args: PlanFacetArgs): Promise<PlanFacetResult> {
  const { facetName, specifier, projectRoot, previousLockfile, onStage, onLog } = args

  // Parse the source specifier.
  onStage({ kind: 'facet-stage', facet: facetName, stage: 'parse' })
  const parsed = parseFacetSource(specifier)
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
      try {
        const cloned = await cloneFacetGitSource(parsed.value.url, cloneRef)
        sourceDir = cloned.dir
        cleanup = async () => {
          await rm(cloned.dir, { recursive: true, force: true }).catch(() => {})
        }
        clonedRef = cloneRef
        clonedCommit = cloned.commit
        onLog(`[verbose]   cloned ${parsed.value.url} → ${sourceDir} (sha: ${cloned.commit ?? '?'})`)
      } catch (error) {
        return {
          ok: false,
          failure: {
            code: 'GIT_CLONE_FAILED',
            facet: facetName,
            cause: error instanceof Error ? error.message : String(error),
          },
        }
      }
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
    // Registry source — currently stubbed; future blocks wire registry
    // resolution + cache + integrity verification here.
    return {
      ok: false,
      failure: {
        code: 'REGISTRY_ERROR',
        facet: facetName,
        error: {
          code: 'REGISTRY_NOT_AVAILABLE',
          what: `registry is not yet available (would query facets.cafe for "${parsed.value.name}")`,
          fix: 'use a github: shortcut, https URL, ssh URL, or local path until the registry ships',
        },
      },
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
    if (trustedCacheHit && locked !== undefined) {
      // Trusted cache hit: sidecar already certified `locked.integrity`
      // at write time. Skip the build pipeline entirely (no canonical
      // tar assembly, no rehashing) and inherit the locked entry verbatim.
      // The lockfile is sticky; we never rewrite locked fields.
      entry = {
        source: specifier,
        ...(locked.ref !== undefined ? { ref: locked.ref } : {}),
        ...(locked.commit !== undefined ? { commit: locked.commit } : {}),
        version: locked.version,
        integrity: locked.integrity,
        assets: locked.assets,
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
      if (locked !== undefined && parsed.value.kind === 'git') {
        const guard = verifyGitOneCheck({
          facet: facetName,
          computedIntegrity: buildResult.integrity,
          lockfileIntegrity: locked.integrity,
        })
        if (!guard.ok) {
          return { ok: false, failure: { code: 'INTEGRITY_FAILURE', failure: guard.failure } }
        }
      }

      // Fresh git clone → audit-then-write to cache. Cache hits already
      // have content in the slot; local sources skip the cache entirely.
      if (cleanup !== undefined && parsed.value.kind === 'git') {
        const buildManifest = JSON.parse(buildResult.manifestJson) as BuildManifest
        const cacheId: CacheIdentity = {
          kind: 'git',
          name: facetName,
          version: buildResult.data.version,
        }
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
      //   - Locked GIT entries inherit locked.* verbatim (we just
      //     verified buildResult matches, so values are equal — but the
      //     lockfile is the source of truth and we never rewrite it).
      //   - Local sources (locked or fresh) derive from the build.
      //     Local is mutable by design; the user owns the version and
      //     content, and the lockfile follows what's on disk.
      //   - Fresh git adds derive from the build + the clone's commit.
      if (locked !== undefined && parsed.value.kind === 'git') {
        entry = {
          source: specifier,
          ...(locked.ref !== undefined ? { ref: locked.ref } : {}),
          ...(locked.commit !== undefined ? { commit: locked.commit } : {}),
          version: locked.version,
          integrity: locked.integrity,
          assets: locked.assets,
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

/**
 * Synthesize a placeholder manifest for a facet being removed during
 * drift cleanup. `materialize` only touches `manifest` for the install
 * branch, which is empty (`newAssets: []`) for removals — so the fields
 * here are never read.
 */
function removalManifest(facetName: string): ResolvedFacetManifest {
  return {
    name: facetName,
    version: '0.0.0',
  }
}

/**
 * Classify a per-facet outcome by comparing the previous lockfile entry
 * (if any) against the new one. `assetsWritten` is the count of assets
 * `materialize` actually wrote (excluding skipped no-ops); when it's >0
 * but the lockfile entry is identical, the facet was "repaired" — the
 * on-disk state had drifted (file deleted, content edited) and we
 * restored it without bumping the version.
 */
function classifyOutcome(
  name: string,
  previous: LockfileFacet | undefined,
  current: LockfileFacet,
  assetsWritten: number,
): FacetOutcome {
  if (previous === undefined) {
    return { kind: 'installed', name, version: current.version }
  }
  if (previous.version !== current.version) {
    return {
      kind: 'updated',
      name,
      oldVersion: previous.version,
      newVersion: current.version,
    }
  }
  if (assetsWritten > 0) {
    return { kind: 'repaired', name, version: current.version }
  }
  return { kind: 'unchanged', name, version: current.version }
}

/**
 * Helper used by callers (notably the add command) to compute the
 * default `facets.json` map after a successful planFacet — exported so
 * the `facet add` flow can byte-snapshot, mutate, write, then call
 * runInstall.
 *
 * Currently unused but reserved for the add command's wiring.
 */
export type { FacetsJson }
