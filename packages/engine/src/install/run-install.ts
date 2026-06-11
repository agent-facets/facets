import { join } from 'node:path'
import type { FacetsJson, Lockfile, LockfileFacet } from '@agent-facets/protocol'
import { loadFacetsJson, writeFacetsJson } from '../manifest/project-files.ts'
import { describeVersionSpec } from '../registry/describe.ts'
import { classifyOutcome } from './classify-outcome.ts'
import { detectLockfileDrift } from './detect-lockfile-drift.ts'
import { InstallJournal } from './journal.ts'
import { acquireInstallLock } from './lockfile-guard.ts'
import { emptyLockfile, FACETS_LOCK_FILE, loadLockfile, writeLockfile } from './lockfile-io.ts'
import { materialize } from './materialize.ts'
import { materializeFailureToRunInstall } from './materialize-failure.ts'
import { planFacet } from './plan-facet.ts'
import { bootstrapReceipt, loadReceipt, type Receipt, type ReceiptFacetEntry, writeReceipt } from './receipt.ts'
import { removalManifest } from './removal-manifest.ts'
import type {
  Addition,
  FacetOutcome,
  InstallDelta,
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
  const delta: InstallDelta = opts.delta ?? { additions: [], removals: [] }
  const onStage = opts.onStage ?? noopStage
  const onLog = opts.onLog ?? noopLog

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

    // Load (or bootstrap) the machine-local receipt.
    const receiptResult = loadReceipt(projectRoot)
    const receipt: Receipt = receiptResult.ok ? receiptResult.receipt : bootstrapReceipt(projectRoot, previousLockfile)

    // Frozen-lockfile gate: a frozen commit with a non-empty delta is
    // rejected immediately — add/remove can never run frozen.
    const hasDelta = delta.additions.length > 0 || delta.removals.length > 0
    if (opts.frozenLockfile === true && hasDelta) {
      return failureNoMutation({ code: 'FROZEN_WITH_DELTA' })
    }

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

    // Merge the delta into the desired manifest in memory.
    // Additions: upsert into the manifest with the user's specifier.
    // Removals: delete from the manifest.
    // The on-disk facets.json is NOT written yet — it's written as part
    // of the transactional commit at the end.
    const additionsByName = new Map<string, Addition>(delta.additions.map((a) => [a.facetName, a]))
    const removalNames = new Set(delta.removals.map((r) => r.facetName))

    // Build the desired manifest: start from on-disk, apply delta.
    const desiredFacets: Record<string, string> = { ...facetsJson.facets }
    for (const addition of delta.additions) {
      // Write the specifier into the desired manifest. The manifest-write
      // policy (bare → pin, explicit → verbatim) is applied AFTER install
      // succeeds — for now we store the specifier as-is so planFacet can
      // parse it. The final manifest value is computed from the resolved
      // lockfile entry below.
      const manifestValue =
        addition.source.kind === 'registry' ? describeVersionSpec(addition.source.version) : addition.specifier
      desiredFacets[addition.facetName] = manifestValue
    }
    for (const name of removalNames) {
      delete desiredFacets[name]
    }

    onStage({
      kind: 'install-start',
      totalFacets: Object.keys(desiredFacets).length,
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

    for (const [facetName, specifier] of Object.entries(desiredFacets)) {
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
        frozenLockfile: opts.frozenLockfile,
        isExplicitAddition: additionsByName.has(facetName),
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
        facetName,
        manifest: resolved,
        adapters: [...adapters],
        oldAssets,
        newAssets: entry.assets,
        journal,
        onLog,
        onStage,
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

    // 6. Receipt-driven drift removal: facets the receipt records as
    //    materialized but the desired set no longer wants. Also catch
    //    lockfile-only entries (lockfile records it, receipt doesn't — e.g.
    //    the receipt was just bootstrapped and doesn't have the entry yet).
    const unwantedFromReceipt = Object.keys(receipt.facets).filter((name) => desiredFacets[name] === undefined)
    const unwantedFromLockfile = Object.keys(previousLockfile.facets).filter(
      (name) => desiredFacets[name] === undefined && !receipt.facets[name],
    )
    const unwantedNames = [...new Set([...unwantedFromReceipt, ...unwantedFromLockfile])]

    for (const facetName of unwantedNames) {
      if (signal?.aborted) {
        return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
      }

      // The asset set to delete comes from the receipt (preferred) or the
      // lockfile (fallback for entries the receipt doesn't have yet).
      const receiptEntry = receipt.facets[facetName]
      const lockfileEntry = previousLockfile.facets[facetName]
      const oldAssets = receiptEntry?.assets ?? lockfileEntry?.assets ?? []
      const oldVersion = receiptEntry?.version ?? lockfileEntry?.version ?? '0.0.0'

      onStage({ kind: 'drift-removal', facet: facetName, oldVersion })
      const removalResult = await materialize({
        facetName,
        manifest: removalManifest(facetName),
        adapters: [...adapters],
        oldAssets,
        newAssets: [],
        journal,
        onLog,
        onStage,
      })
      if (!removalResult.ok) {
        const failure = materializeFailureToRunInstall(facetName, removalResult.failure)
        return await rollbackAndFail(journal, failure, onLog)
      }
      removedAssets += oldAssets.length * adapters.length
      removed++
      perFacet.push({ kind: 'removed', name: facetName, oldVersion })
    }

    if (signal?.aborted) {
      return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
    }

    // 7. Transactional tri-write: manifest + lockfile + receipt.
    //
    // Wrapped in try/catch because disk I/O can fail (EACCES, ENOSPC, EIO).
    // An unprotected throw after materialization would leave the project
    // inconsistent. Route through `rollbackAndFail` so the journal undoes
    // the materialize and the caller gets a structured failure.
    const newLockfile: Lockfile = {
      lockfileVersion: previousLockfile.lockfileVersion,
      facets: newFacetEntries,
    }

    // Build the new receipt from the desired set. The receipt is always
    // written — even in frozen mode (materialization state converges).
    const newReceiptFacets: Record<string, ReceiptFacetEntry> = {}
    for (const [name, entry] of Object.entries(newFacetEntries)) {
      newReceiptFacets[name] = {
        version: entry.version,
        assets: entry.assets.map((a) => ({ scope: a.scope, type: a.type, name: a.name })),
      }
    }
    const newReceipt: Receipt = { ...receipt, facets: newReceiptFacets }

    if (opts.frozenLockfile === true) {
      // Frozen mode: write receipt only — never the manifest or lockfile.
      try {
        writeReceipt(projectRoot, newReceipt)
      } catch {
        // Receipt write failure in frozen mode is non-fatal — the receipt
        // is machine-local convenience state, not the locked set.
      }
    } else {
      // Apply the manifest-write policy for additions before writing.
      // - Bare registry add (kind: 'latest') → pin to the resolved exact version.
      // - Explicit registry specifier → write verbatim (already in desiredFacets).
      // - Git/local → write the specifier verbatim (already in desiredFacets).
      // - Reproduction (not an addition) → leave unchanged (already in desiredFacets).
      if (hasDelta) {
        for (const addition of delta.additions) {
          const lockEntry = newFacetEntries[addition.facetName]
          if (lockEntry === undefined) continue
          if (addition.source.kind === 'registry' && addition.source.version.kind === 'latest') {
            desiredFacets[addition.facetName] = lockEntry.version
          }
        }
      }

      try {
        // Tri-write: manifest + lockfile + receipt.
        const newManifest: FacetsJson = { ...facetsJson, facets: desiredFacets }
        writeFacetsJson(projectRoot, newManifest)
        writeLockfile(projectRoot, newLockfile)
        writeReceipt(projectRoot, newReceipt)
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
