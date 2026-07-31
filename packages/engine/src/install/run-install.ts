import { join } from 'node:path'
import { CURRENT_LOCKFILE_VERSION } from '@agent-facets/protocol'
import { type AdapterCompatibilityFailure, compatibilityFailureFor } from '../adapters/api-compatibility.ts'
import type { NormalizedProjectManifest } from '../manifest/mutations.ts'
import { describeManifestFailure, loadProjectManifest } from '../manifest/project-files.ts'
import { compose } from './commit/compose.ts'
import { applyManifestWritePolicy, mergeDeltaIntoManifest } from './commit/delta.ts'
import { removedFacetOutcomes } from './commit/drift-removal.ts'
import { finalizeMaterializationIntent } from './commit/finalize-intent.ts'
import { installFacets } from './commit/install-loop.ts'
import { buildPreviousOwnership, obsoleteOwnership } from './commit/ownership.ts'
import { resolveAll } from './commit/resolve-all.ts'
import { buildUpdatedReceipt, commitProjectFiles, type LockedSetCommit } from './commit/tri-write.ts'
import { checkFrozenConsistency } from './frozen-gates.ts'
import { InstallJournal } from './journal.ts'
import { acquireInstallLock } from './lockfile-guard.ts'
import { FACETS_LOCK_FILE, loadLockfile } from './lockfile-io.ts'
import { deleteObsoleteAssets } from './materialize.ts'
import { materializeFailureToRunInstall } from './materialize-failure.ts'
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
  const { projectRoot, adapters, signal, resolveCollisions } = opts
  const delta: InstallDelta = opts.delta ?? { additions: [], removals: [] }
  const onStage = opts.onStage ?? noopStage
  const onLog = opts.onLog ?? noopLog
  const frozenLockfile = opts.frozenLockfile === true

  // 1. Load facets.json. When the delta carries additions and no manifest
  //    exists yet, start from an empty skeleton — the manifest will be
  //    created as part of the transactional write. Without a delta, a
  //    missing manifest is still a hard error (plain `facet install` with
  //    nothing to install).
  const manifestResult = loadProjectManifest(projectRoot)
  if (!manifestResult.ok) {
    if (manifestResult.reason === 'invalid' && manifestResult.failure.code === 'unsupported-manifest-version') {
      return failureWithoutRollback({
        code: 'FACETS_JSON_UNSUPPORTED_VERSION',
        path: join(projectRoot, 'facets.json'),
        observed: manifestResult.failure.observed,
        supported: manifestResult.failure.supported,
      })
    }
    return failureWithoutRollback({
      code: 'FACETS_JSON_INVALID',
      path: join(projectRoot, 'facets.json'),
      error: manifestResult.reason === 'read' ? manifestResult.error : describeManifestFailure(manifestResult.failure),
    })
  }
  if (!manifestResult.existed && delta.additions.length === 0) {
    return failureWithoutRollback({
      code: 'FACETS_JSON_NOT_FOUND',
      path: join(projectRoot, 'facets.json'),
    })
  }
  const projectManifest: NormalizedProjectManifest = manifestResult.manifest

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

  try {
    // 3. Frozen mode can never carry a delta: adding or removing a facet
    //    changes the locked set by definition. Checked before the lockfile is
    //    even read, so `facet add --frozen-lockfile` against a corrupt
    //    lockfile reports the operation it cannot perform rather than a file
    //    it never needed to open.
    const hasDelta = delta.additions.length > 0 || delta.removals.length > 0
    if (frozenLockfile && hasDelta) {
      return failureNoMutation({ code: 'FROZEN_WITH_DELTA' })
    }

    // 4. Load existing lockfile (or skeleton).
    const lockfileResult = loadLockfile(projectRoot)
    if (!lockfileResult.ok) {
      return failureNoMutation({
        code: 'LOCKFILE_INVALID',
        path: join(projectRoot, FACETS_LOCK_FILE),
        error: lockfileResult.error,
      })
    }
    // The loaded document, at whatever version it was written. Both arms
    // carry a validated lockfile; the `existed` tag only distinguishes "read
    // from disk" from "bootstrapped empty at the current version".
    const previousLockfile = lockfileResult.parsed.lockfile

    // Load (or bootstrap) the machine-local receipt. Invalid asset
    // entries (escape paths) are reported and skipped — the rest of
    // the receipt is still processed (W2 / design D6).
    const receiptResult = loadReceipt(projectRoot)
    const receipt: Receipt = receiptResult.ok ? receiptResult.receipt : bootstrapReceipt(projectRoot, previousLockfile)
    if (receiptResult.ok) {
      for (const invalid of receiptResult.invalidEntries) {
        onLog(() => `[warn] receipt asset entry rejected for ${invalid.facet}: "${invalid.asset}" (${invalid.reason})`)
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

    // 3c. Adapter API preflight — defense-in-depth behind the
    //     command-level fail-closed load. Runs on the no-mutation path
    //     before the per-facet loop, which also precedes any Git/local
    //     facet build, drift removal, and every materialization write.
    //     Collects every incompatible adapter, not just the first.
    const incompatibleAdapters: AdapterCompatibilityFailure[] = []
    for (const adapter of adapters) {
      const incompatibility = compatibilityFailureFor(adapter.name, adapter.apiVersion)
      if (incompatibility !== null) incompatibleAdapters.push(incompatibility)
    }
    if (incompatibleAdapters.length > 0) {
      return failureNoMutation({ code: 'ADAPTER_INCOMPATIBLE', failures: incompatibleAdapters })
    }

    // 4. Frozen-lockfile gates. A frozen commit with a non-empty delta is
    //    rejected immediately — add/remove can never run frozen. The
    //    drift preflight runs before any mutation/journal entry so drift
    //    leaves the project untouched: every manifest facet MUST have a
    //    lockfile entry whose version satisfies its specifier.
    //
    //    Frozen consistency BEFORE cleanup (design D10, task 9.5): this gate
    //    completes — on the no-mutation path — before the receipt-driven
    //    drift removal at step 6 runs. `detectLockfileDrift` surfaces an
    //    `orphaned` lockfile entry (pinned in the lockfile, absent from the
    //    manifest) as drift here, so a frozen install rejecting an orphan
    //    fails BEFORE cleanup deletes any materialized asset. Without this,
    //    the drift-removal loop would delete the orphan's assets while the
    //    frozen lockfile write is skipped, leaving adapter state mutated and
    //    the stale entry on disk. Receipt-only orphans (present in the
    //    receipt but not the lockfile) are not lockfile drift and are cleaned
    //    up normally under frozen — only the receipt is rewritten.
    const merged = mergeDeltaIntoManifest(projectManifest.facets, delta)
    if (frozenLockfile) {
      const inconsistent = checkFrozenConsistency({
        facets: projectManifest.facets,
        previousLockfile,
        lockfileVersion: lockfileResult.parsed.lockfileVersion,
        lockfileExisted: lockfileResult.existed,
      })
      if (inconsistent !== null) {
        return failureNoMutation(inconsistent)
      }
    }

    onStage({ kind: 'install-start', totalFacets: Object.keys(merged.desiredFacets).length })

    // 5. Resolve every desired facet. Nothing is written during this phase,
    //    so a failure here still leaves the project untouched — which is
    //    why it reports through the no-mutation helper and why no journal
    //    exists yet.
    const resolution = await resolveAll({
      desiredFacets: merged.desiredFacets,
      additionNames: merged.additionNames,
      previousLockfile,
      projectRoot,
      adapters,
      frozenLockfile,
      signal,
      onStage,
      onLog,
    })
    if (!resolution.ok) {
      return failureNoMutation(resolution.failure)
    }
    const { resolved, serverWarnings } = resolution.value

    // 6. Compose the global plan. Still no journal and still nothing
    //    written: a collision, an invalid alias, or a cancelled resolution
    //    leaves the project exactly as it was.
    const composed = await compose({
      resolved,
      desiredFacets: merged.desiredFacets,
      frozenLockfile,
      resolveCollisions,
      onStage,
    })
    if (!composed.ok) {
      return failureNoMutation(composed.failure)
    }
    const plan = composed.plan

    // 7. The first mutation is now imminent, so the rollback ledger opens
    //    here. Every entry it accumulates corresponds to a write that
    //    actually happened.
    const journal = new InstallJournal()

    // 7a. Index what this machine already has, keyed by EFFECTIVE adapter
    //     identity rather than by facet. Both halves of Apply read it: the
    //     delete pass to find identities nothing wants any more, the write
    //     pass to learn which owned companion paths a replacement may remove.
    const previousOwnership = buildPreviousOwnership(receipt, previousLockfile)

    // 7b. Facets being dropped, for the summary. Computed before the delete
    //     pass so the progress events precede the work they describe; the
    //     deletion itself is global, not per facet.
    const removedOutcomes = removedFacetOutcomes({
      desiredFacets: merged.desiredFacets,
      receipt,
      previousLockfile,
    })
    for (const outcome of removedOutcomes) {
      if (outcome.kind !== 'removed') continue
      onStage({ kind: 'drift-removal', facet: outcome.name, oldVersion: outcome.oldVersion })
    }

    // 8. Apply, pass 1: delete every obsolete effective identity, once.
    //    Deletes precede writes globally so a name transferring between
    //    facets is never deleted after its new owner has written it, and an
    //    identity still claimed by any desired asset is retained outright.
    const obsolete = obsoleteOwnership(previousOwnership, plan.materialized)
    const deletion = await deleteObsoleteAssets({
      adapters: [...adapters],
      obsolete,
      journal,
      onLog,
    })
    if (!deletion.ok) {
      const failure = materializeFailureToRunInstall(deletion.facets[0] ?? '', deletion.failure)
      return await rollbackAndFail(journal, failure, onLog)
    }

    if (signal?.aborted) {
      return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
    }

    // 9. Apply, pass 2: write every desired asset under its effective name.
    const loop = await installFacets({
      resolved,
      plan,
      previousOwnership,
      adapters,
      journal,
      signal,
      onStage,
      onLog,
    })
    if (!loop.ok) {
      return await rollbackAndFail(journal, loop.failure, onLog)
    }
    const { newFacetEntries, perFacet, totalAssets } = loop.value
    perFacet.push(...removedOutcomes)

    if (signal?.aborted) {
      return await rollbackAndFail(journal, { code: 'ABORTED' }, onLog)
    }

    // 9. Transactional tri-write: manifest + lockfile + receipt (receipt
    //    only under frozen). The manifest-write policy (bare → pin,
    //    explicit → verbatim) is applied just before the write.
    //
    //    Version migration (design D10): a normal install always writes the
    //    current schema, migrating a legacy-alpha `1` or `0.2` lockfile after
    //    every resolved artifact has passed verification. Frozen mode never
    //    rewrites the lockfile, so it retains the version the file was loaded
    //    under — a newer archive against a legacy lockfile is rejected by the
    //    frozen drift gate above, not silently upgraded here.
    const lockedSet: LockedSetCommit = frozenLockfile
      ? { kind: 'retain' }
      : { kind: 'write', newLockfile: { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: newFacetEntries } }
    const newReceipt = buildUpdatedReceipt(receipt, newFacetEntries)
    if (!frozenLockfile && merged.hasDelta) {
      applyManifestWritePolicy(merged.desiredFacets, delta.additions, newFacetEntries)
    }

    // Finalize project intent. This is where a resolver's accepted choices
    // become durable and where a stale override is dropped — both in memory,
    // both reaching disk only through the write below. Frozen mode never
    // rewrites the manifest, so it neither persists nor prunes: a stale
    // override under frozen is drift, reported by the gate above.
    const pruned = frozenLockfile
      ? []
      : finalizeMaterializationIntent(merged.desiredFacets, plan.overrides, plan.staleOverrides)

    const written = commitProjectFiles({
      projectRoot,
      manifestDocument: projectManifest.document,
      desiredFacets: merged.desiredFacets,
      lockedSet,
      newReceipt,
      onLog,
    })
    if (!written.ok) {
      return await rollbackAndFail(journal, written.failure, onLog)
    }
    if (!frozenLockfile) {
      onStage({ kind: 'lockfile-write', path: join(projectRoot, FACETS_LOCK_FILE) })
    }

    // Reported only now: before the write, the prune had not happened, and a
    // failed transaction leaves every override on disk untouched.
    for (const entry of pruned) {
      onStage({
        kind: 'stale-override-pruned',
        facet: entry.facet,
        assetType: entry.type,
        authoredName: entry.authoredName,
      })
    }

    onStage({ kind: 'install-complete', outcome: 'success' })

    return {
      ok: true,
      // Frozen retained the file on disk, so the previous lockfile IS the
      // current one — reporting the composed set would claim a write that
      // never happened.
      lockfile: lockedSet.kind === 'write' ? lockedSet.newLockfile : previousLockfile,
      // `deletion.deleted` counts identities that actually existed on disk,
      // across every adapter — not a per-facet estimate multiplied out.
      summary: summarize(perFacet, totalAssets, deletion.deleted),
      perFacet,
      serverWarnings,
    }
  } finally {
    await installLock.release()
  }

  function noopStage(_event: StageEvent): void {}
  function noopLog(_build: () => string): void {}

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
