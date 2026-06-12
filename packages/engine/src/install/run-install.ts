import { join } from 'node:path'
import type { FacetsJson, Lockfile } from '@agent-facets/protocol'
import { loadFacetsJson } from '../manifest/project-files.ts'
import { applyManifestWritePolicy, mergeDeltaIntoManifest } from './commit/delta.ts'
import { removeDriftedFacets } from './commit/drift-removal.ts'
import { installFacets } from './commit/install-loop.ts'
import { buildUpdatedReceipt, commitProjectFiles } from './commit/tri-write.ts'
import { detectLockfileDrift } from './detect-lockfile-drift.ts'
import { InstallJournal } from './journal.ts'
import { acquireInstallLock } from './lockfile-guard.ts'
import { emptyLockfile, FACETS_LOCK_FILE, loadLockfile } from './lockfile-io.ts'
import { bootstrapReceipt, loadReceipt, type Receipt } from './receipt.ts'
import { rollbackAndFail, summarize } from './run-install-support.ts'
import type { InstallDelta, RunInstallFailure, RunInstallOptions, RunInstallResult, StageEvent } from './types.ts'

/**
 * Run the install pipeline for a project — the commit orchestrator.
 *
 * Behavior is uniform across all callers (add, remove, install): the
 * delta is merged in memory, every desired facet is resolved through
 * the commit-phase machinery in `install/commit/`, drift is removed
 * against the machine-local receipt, and the manifest + lockfile +
 * receipt are written together at the end.
 *
 * Always returns; never throws. Failures are reported via
 * `result.failure`; rollback status via `result.rollback`.
 */
export async function runInstall(opts: RunInstallOptions): Promise<RunInstallResult> {
  const { projectRoot, adapters, signal } = opts
  const delta: InstallDelta = opts.delta ?? { additions: [], removals: [] }
  const onStage = opts.onStage ?? noopStage
  const onLog = opts.onLog ?? noopLog
  const frozenLockfile = opts.frozenLockfile === true

  // 1. Load facets.json. When the delta carries additions and no manifest
  //    exists yet, start from an empty skeleton — the manifest will be
  //    created as part of the transactional write. Without a delta, a
  //    missing manifest is still a hard error (plain `facet install` with
  //    nothing to install).
  const facetsJsonResult = loadFacetsJson(projectRoot)
  if (!facetsJsonResult.ok) {
    return failureWithoutRollback({
      code: 'FACETS_JSON_INVALID',
      path: join(projectRoot, 'facets.json'),
      error: facetsJsonResult.error,
    })
  }
  if (!facetsJsonResult.existed && delta.additions.length === 0) {
    return failureWithoutRollback({
      code: 'FACETS_JSON_NOT_FOUND',
      path: join(projectRoot, 'facets.json'),
    })
  }
  const facetsJson: FacetsJson = facetsJsonResult.existed ? facetsJsonResult.data : { facets: {} }

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

    // Load (or bootstrap) the machine-local receipt. Invalid asset
    // entries (escape paths) are reported and skipped — the rest of
    // the receipt is still processed (W2 / design D6).
    const receiptResult = loadReceipt(projectRoot)
    const receipt: Receipt = receiptResult.ok ? receiptResult.receipt : bootstrapReceipt(projectRoot, previousLockfile)
    if (receiptResult.ok) {
      for (const invalid of receiptResult.invalidEntries) {
        onLog(`[warn] receipt asset entry rejected for ${invalid.facet}: "${invalid.asset}" (${invalid.reason})`)
        onStage({ kind: 'receipt-invalid-asset', ...invalid })
      }
    }

    // 3b. Delta conflict check. The same facet name in both additions
    //     and removals is an illegal state the CLI should never produce;
    //     this check is defense-in-depth, run before the install lock.
    const additionNames = new Set(delta.additions.map((a) => a.facetName))
    const conflict = delta.removals.find((r) => additionNames.has(r.facetName))
    if (conflict !== undefined) {
      return failureNoMutation({ code: 'DELTA_CONFLICT', facet: conflict.facetName })
    }

    // 4. Frozen-lockfile gates. A frozen commit with a non-empty delta is
    //    rejected immediately — add/remove can never run frozen. The
    //    drift preflight runs before any mutation/journal entry so drift
    //    leaves the project untouched: every manifest facet MUST have a
    //    lockfile entry whose version satisfies its specifier.
    const merged = mergeDeltaIntoManifest(facetsJson.facets, delta)
    if (frozenLockfile && merged.hasDelta) {
      return failureNoMutation({ code: 'FROZEN_WITH_DELTA' })
    }
    if (frozenLockfile) {
      const drift = detectLockfileDrift(facetsJson, previousLockfile, lockfileResult.existed)
      if (drift.length > 0) {
        return failureNoMutation({ code: 'LOCKFILE_DRIFT', facets: drift })
      }
    }

    onStage({ kind: 'install-start', totalFacets: Object.keys(merged.desiredFacets).length })

    // 5. Per-facet install loop.
    const loop = await installFacets({
      desiredFacets: merged.desiredFacets,
      additionNames: merged.additionNames,
      previousLockfile,
      projectRoot,
      adapters,
      frozenLockfile,
      journal,
      signal,
      onStage,
      onLog,
    })
    if (!loop.ok) {
      return await rollbackAndFail(journal, loop.failure, onLog)
    }
    const { newFacetEntries, perFacet, serverWarnings, totalAssets } = loop.value

    // 6. Receipt-driven drift removal.
    const drift = await removeDriftedFacets({
      desiredFacets: merged.desiredFacets,
      receipt,
      previousLockfile,
      adapters,
      journal,
      signal,
      onStage,
      onLog,
    })
    if (!drift.ok) {
      return await rollbackAndFail(journal, drift.failure, onLog)
    }
    perFacet.push(...drift.value.outcomes)

    if (signal?.aborted) {
      return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
    }

    // 7. Transactional tri-write: manifest + lockfile + receipt (receipt
    //    only under frozen). The manifest-write policy (bare → pin,
    //    explicit → verbatim) is applied just before the write.
    const newLockfile: Lockfile = {
      lockfileVersion: previousLockfile.lockfileVersion,
      facets: newFacetEntries,
    }
    const newReceipt = buildUpdatedReceipt(receipt, newFacetEntries)
    if (!frozenLockfile && merged.hasDelta) {
      applyManifestWritePolicy(merged.desiredFacets, delta.additions, newFacetEntries)
    }
    const written = commitProjectFiles({
      projectRoot,
      facetsJson,
      desiredFacets: merged.desiredFacets,
      newLockfile,
      newReceipt,
      frozenLockfile,
      onLog,
    })
    if (!written.ok) {
      return await rollbackAndFail(journal, written.failure, onLog)
    }
    if (!frozenLockfile) {
      onStage({ kind: 'lockfile-write', path: join(projectRoot, FACETS_LOCK_FILE) })
    }

    onStage({ kind: 'install-complete', outcome: 'success' })

    return {
      ok: true,
      lockfile: newLockfile,
      summary: summarize(perFacet, totalAssets, drift.value.removedAssets),
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
