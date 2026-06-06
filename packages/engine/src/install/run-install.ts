import { join } from 'node:path'
import type { FacetsJson, Lockfile, LockfileFacet } from '@agent-facets/protocol'
import { loadFacetsJson } from '../manifest/project-files.ts'
import { classifyOutcome } from './classify-outcome.ts'
import { detectLockfileDrift } from './detect-lockfile-drift.ts'
import { InstallJournal } from './journal.ts'
import { acquireInstallLock } from './lockfile-guard.ts'
import { emptyLockfile, FACETS_LOCK_FILE, loadLockfile, writeLockfile } from './lockfile-io.ts'
import { materialize } from './materialize.ts'
import { materializeFailureToRunInstall } from './materialize-failure.ts'
import { planFacet } from './plan-facet.ts'
import { removalManifest } from './removal-manifest.ts'
import type {
  FacetOutcome,
  InstallSummary,
  RunInstallFailure,
  RunInstallOptions,
  RunInstallResult,
  StageEvent,
} from './types.ts'

/**
 * Run the install pipeline for a project.
 *
 * Behavior is uniform across all callers (add, install, future TUI):
 *
 *   - For each facet declared in `facets.json`, honor the lockfile
 *     entry's pinned version if one exists and satisfies the manifest;
 *     otherwise resolve fresh from the manifest specifier (bun-style
 *     bootstrap, or re-resolving a stale entry).
 *   - Drift removal: any facet in the prior lockfile that's no longer
 *     in `facets.json` has its assets removed.
 *   - Always materialize, always write the lockfile (except in
 *     frozen-lockfile mode).
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
  const facetsJson: FacetsJson = facetsJsonResult.data

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

    // Frozen-lockfile pre-flight. Runs before any mutation/journal entry so
    // drift leaves the project untouched. The lockfile is authoritative:
    // every manifest facet MUST have a lockfile entry whose version
    // satisfies its specifier, or the install fails with LOCKFILE_DRIFT.
    if (opts.frozenLockfile === true) {
      const drift = detectLockfileDrift(facetsJson, previousLockfile, lockfileResult.existed)
      if (drift.length > 0) {
        return failureNoMutation({ code: 'LOCKFILE_DRIFT', facets: drift })
      }
    }

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
      const materializeResult = await materialize({
        manifest: resolved,
        adapters: [...adapters],
        oldAssets,
        newAssets: entry.assets,
        journal,
        onLog,
      })
      if (!materializeResult.ok) {
        const failure = materializeFailureToRunInstall(facetName, materializeResult.failure)
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
      const removalResult = await materialize({
        manifest: removalManifest(facetName),
        adapters: [...adapters],
        oldAssets: prevEntry.assets,
        newAssets: [],
        journal,
        onLog,
      })
      if (!removalResult.ok) {
        const failure = materializeFailureToRunInstall(facetName, removalResult.failure)
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
    // Frozen-lockfile mode treats the lockfile as the source of truth and
    // MUST NOT write it. The pre-flight already proved the lockfile covers
    // the manifest, so install reused each entry's locked version, integrity,
    // and assets. `newLockfile` is rebuilt in memory for the return value but
    // is intentionally not persisted — note that each entry's `source` tracks
    // the current manifest specifier (e.g. a `1.*` range) and may therefore
    // differ from the pinned `source` on disk even when the version still
    // satisfies, so `newLockfile` is not necessarily byte-equal to the file.
    if (opts.frozenLockfile !== true) {
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
    }

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
    return {
      ok: false,
      failure,
      rollback: {
        kind: 'not-needed',
        reason: 'failed after lock acquired but before any disk mutations',
      },
    }
  }

  /**
   * Failure path that runs before the install lock has even been
   * acquired (e.g., facets.json missing). Same as `failureNoMutation`
   * but skips the lock release in `finally` because no lock was taken.
   */
  function failureWithoutRollback(failure: RunInstallFailure): RunInstallResult {
    onStage({ kind: 'install-complete', outcome: 'failure' })
    return {
      ok: false,
      failure,
      rollback: { kind: 'not-needed', reason: 'failed before install lock acquired' },
    }
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
    rollback: rollback.ok
      ? { kind: 'succeeded', entriesUndone: rollback.entriesUndone }
      : { kind: 'partial-failure', entriesUndone: rollback.entriesUndone, failures: rollback.failures },
  }
}
