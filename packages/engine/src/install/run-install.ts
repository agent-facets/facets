import { join } from 'node:path'
import type { PlannedServerConfiguration } from '@agent-facets/protocol'
import { CURRENT_LOCKFILE_VERSION, preserveLockfileExtensions } from '@agent-facets/protocol'
import { type AdapterCompatibilityFailure, compatibilityFailureFor } from '../adapters/api-compatibility.ts'
import { FileTransaction } from '../fs/index.ts'
import { FACETS_JSON_FILE, type NormalizedProjectManifest } from '../manifest/mutations.ts'
import { loadProjectManifest, manifestLoadFailure } from '../manifest/project-files.ts'
import { classifyOutcome, facetConfigurationWork, NO_CONFIGURATION_WORK } from './classify-outcome.ts'
import { compose } from './commit/compose.ts'
import { applyManifestWritePolicy, mergeDeltaIntoManifest } from './commit/delta.ts'
import { removedFacetOutcomes } from './commit/drift-removal.ts'
import { finalizeMaterializationIntent, type PrunedOverride } from './commit/finalize-intent.ts'
import { installFacets } from './commit/install-loop.ts'
import { buildPreviousOwnership, obsoleteOwnership } from './commit/ownership.ts'
import { resolveAll } from './commit/resolve-all.ts'
import {
  buildPreviousMcpOwnership,
  claimsByFacet,
  obsoleteMcpOwnership,
  previouslyOwnedServerNames,
} from './commit/server-ownership.ts'
import {
  buildUpdatedReceipt,
  commitProjectFiles,
  type LockedSetCommit,
  readProjectFileStates,
} from './commit/tri-write.ts'
import { checkFrozenConsistency, checkFrozenServerIntent } from './frozen-gates.ts'
import { acquireInstallLock } from './lockfile-guard.ts'
import { FACETS_LOCK_FILE, loadLockfile } from './lockfile-io.ts'
import { deleteObsoleteAssets } from './materialize.ts'
import { materializeFailureToRunInstall } from './materialize-failure.ts'
import { applyMcpServers } from './mcp/apply.ts'
import { deriveMcpConsent, type McpConsentPolicy, settleMcpConsent } from './mcp/consent.ts'
import {
  classifyMcpConfigurations,
  classifyMcpDispositions,
  type McpConfigurationOutcome,
  type McpConsentOutcome,
  type McpInstallOutcomes,
  mcpIntentBaseline,
  NO_MCP_OUTCOMES,
  type PrunedServerIntent,
  summarizeMcpConsentRequest,
} from './mcp/outcomes.ts'
import { prepareMcpServers } from './mcp/prepare.ts'
import { ownEntry } from './own-entry.ts'
import { receiptProjectPath, resolveProjectReceipt } from './receipt.ts'
import { refineRemoval } from './remove/refine.ts'
import { rollbackAndFail, summarize } from './run-install-support.ts'
import type {
  FacetOutcome,
  InstallDelta,
  RunInstallFailure,
  RunInstallOptions,
  RunInstallResult,
  StageEvent,
} from './types.ts'

/**
 * Run the install pipeline for a project — the commit orchestrator.
 *
 * One orchestrator behind three front doors (add, remove, install). The
 * delta is merged in memory; then either
 *
 *   - a non-frozen removal-only delta that this machine's receipt already
 *     witnesses for every remaining facet is refined without resolution, or
 *   - every desired facet is resolved through the commit-phase machinery in
 *     `install/commit/`.
 *
 * Either way, drift is removed against the machine-local receipt and the
 * manifest + lockfile + receipt are written together at the end.
 *
 * Always returns; never throws. Failures are reported via
 * `result.failure`; rollback status via `result.rollback`.
 */
export async function runInstall(opts: RunInstallOptions): Promise<RunInstallResult> {
  const { projectRoot, adapters, signal, resolveCollisions, resolveAssetTakeover } = opts
  const delta: InstallDelta = opts.delta ?? { additions: [], removals: [] }
  const onStage = opts.onStage ?? noopStage
  const onLog = opts.onLog ?? noopLog
  const frozenLockfile = opts.frozenLockfile === true
  // Absent means "this caller cannot answer", which is what makes failing
  // with the complete request the default rather than a special case.
  const mcpConsent: McpConsentPolicy = opts.mcpConsent ?? { kind: 'unavailable' }

  // 1. Acquire the install lock BEFORE reading anything a commit is derived
  //    from. Reading first left a window in which a concurrent operation
  //    could commit: this run would then merge against a snapshot taken
  //    before that commit existed and write it back over the top. Lock
  //    contention is therefore the only outcome that can precede the lock,
  //    which also keeps "another operation owns this project" distinct from
  //    "this project's state is unusable".
  const lockResult = acquireInstallLock(projectRoot)
  if (!lockResult.ok) {
    onStage({ kind: 'install-complete', outcome: 'failure' })
    return {
      ok: false,
      failure: { code: 'LOCK_HELD', path: lockResult.path, heldByPid: lockResult.heldByPid },
      rollback: { kind: 'not-needed', reason: 'pre-lock' },
    }
  }
  const installLock = lockResult.lock

  try {
    // 2. Load facets.json, now under the lock. When the delta carries
    //    additions and no manifest exists yet, start from an empty skeleton —
    //    the manifest will be created as part of the transactional write.
    //    Without a delta, a missing manifest is still a hard error (plain
    //    `facet install` with nothing to install).
    const manifestResult = loadProjectManifest(projectRoot)
    if (!manifestResult.ok) {
      // Routed through the shared classifier rather than re-branched here, so
      // the orchestrator and the two prepare phases cannot disagree about
      // which load failures are "repair the document" and which are "this CLI
      // is too old" — the distinction the CLI's remedy depends on.
      const loadFailure = manifestLoadFailure(projectRoot, manifestResult)
      if (loadFailure.reason === 'manifest-unsupported-version') {
        return failureNoMutation({
          code: 'FACETS_JSON_UNSUPPORTED_VERSION',
          path: loadFailure.path,
          observed: loadFailure.observed,
          supported: loadFailure.supported,
        })
      }
      return failureNoMutation({
        code: 'FACETS_JSON_INVALID',
        path: join(projectRoot, FACETS_JSON_FILE),
        error: loadFailure.error,
      })
    }
    if (!manifestResult.existed && delta.additions.length === 0) {
      return failureNoMutation({ code: 'FACETS_JSON_NOT_FOUND', path: join(projectRoot, FACETS_JSON_FILE) })
    }
    const projectManifest: NormalizedProjectManifest = manifestResult.manifest

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

    // Load the machine-local receipt — the only thing that can witness what
    // THIS machine materialized, and therefore the only authority for
    // deletion. An unusable receipt claims nothing rather than borrowing the
    // lockfile's claims. Invalid asset entries (escape paths) are reported and
    // skipped — the rest of the receipt is still processed (W2 / design D6).
    const receiptState = resolveProjectReceipt(projectRoot)
    const receiptPath = receiptProjectPath(receiptState)
    if (receiptState.kind === 'loaded') {
      for (const invalid of receiptState.invalidEntries) {
        if (invalid.kind === 'asset') {
          onLog(
            () => `[warn] receipt asset entry rejected for ${invalid.facet}: "${invalid.asset}" (${invalid.reason})`,
          )
          onStage({ kind: 'receipt-invalid-asset', facet: invalid.facet, asset: invalid.asset, reason: invalid.reason })
          continue
        }
        onLog(
          () => `[warn] receipt server claim rejected for ${invalid.facet}: "${invalid.server}" (${invalid.reason})`,
        )
        onStage({
          kind: 'receipt-invalid-configuration',
          facet: invalid.facet,
          server: invalid.server,
          reason: invalid.reason,
        })
      }
    } else if (receiptState.reason !== 'missing') {
      // A receipt that exists but cannot be read is an anomaly with a large
      // consequence: every identity this machine had tracked is now untracked,
      // so nothing can be cleaned up and this run's record starts from scratch.
      // `missing` is silent by contrast — that is just a first operation.
      onLog(() => `[warn] install receipt unreadable (${receiptState.reason}); nothing on disk is tracked`)
      onStage({ kind: 'receipt-unavailable', reason: receiptState.reason })
    }

    // The exact states of the three files this run may commit, read once,
    // under the lock, before anything is resolved. The commit is conditional
    // on them: a manifest a teammate's editor rewrote while this install was
    // fetching is not the manifest the plan was computed from, and writing
    // over it would discard their edit as silently as it would discard ours.
    const projectFiles = readProjectFileStates(projectRoot)
    if (!projectFiles.ok) {
      return failureNoMutation(projectFiles.failure)
    }
    const loadedStates = projectFiles.states

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

    // 5. Removal without resolution.
    //
    //    Removing a facet asks only about state this machine already has, so
    //    when local state answers it for every REMAINING facet, nothing is
    //    fetched, rebuilt, or reverified. That is what makes removal work with
    //    a cold cache and an unreachable registry — previously only the facet
    //    being removed enjoyed that guarantee, while an unrelated remaining
    //    facet being unavailable failed the whole operation.
    //
    //    "Local state" means the receipt, not the lockfile. Writing nothing is
    //    only safe when every remaining materialization is TRACKED — witnessed
    //    by this machine's own record. When it is not — a remaining facet was
    //    never locked or never recorded, its entry drifted, the locked set
    //    collides, or the manifest declares intent the lockfile does not
    //    record — the ordinary pipeline runs instead, materializes the
    //    remaining desired state, and only then claims it.
    //
    //    The route is chosen from the REQUEST: any delta that carries only
    //    removals may be answered locally. Gating on how many of those names
    //    still exist under the lock would send the fully-absent case — every
    //    requested name already gone, which is precisely the state a
    //    concurrent removal leaves behind — down the resolve path to fetch
    //    every unrelated facet in the project for an operation with nothing
    //    to do.
    //
    //    Which requested removals actually APPLY is a separate question,
    //    answered here from the manifest loaded under the lock and used only
    //    for reporting. A name absent under the lock removes nothing (the
    //    merge already treats it as a no-op), and a name a concurrent commit
    //    declared after a caller's pre-lock validation is still removed,
    //    because the request rather than a stale snapshot reached the delta.
    const effectiveRemovals = delta.removals.filter(
      (removal) => ownEntry(projectManifest.facets, removal.facetName) !== undefined,
    )
    const removalOnly = delta.removals.length > 0 && delta.additions.length === 0
    const refinement =
      removalOnly && !frozenLockfile
        ? refineRemoval({
            desiredFacets: merged.desiredFacets,
            previousLockfile,
            lockfileExisted: lockfileResult.existed,
            receiptState,
          })
        : null
    if (refinement !== null && refinement.kind === 'not-applicable') {
      onLog(() => `[verbose] removal needs full resolution (${refinement.reason.code})`)
      onStage({ kind: 'removal-resolution-required', reason: refinement.reason.code })
    }

    if (refinement !== null && refinement.kind === 'refined') {
      const refined = refinement.refinement
      onStage({ kind: 'install-start', totalFacets: effectiveRemovals.length })

      // Cancellation checkpoint, before the journal opens and before the
      // delete pass — the same boundary the resolve path checks at. Without
      // it this branch accepted `signal` and never read it, so Ctrl-C during
      // a removal still deleted assets and committed the manifest.
      if (signal?.aborted) {
        return failureNoMutation({ code: 'ABORTED' })
      }

      // Configuration cleanup is prepared here, on the no-mutation path, for
      // the same reason the resolve path prepares before its journal opens.
      //
      // The request is deliberately asymmetric: nothing is desired, and the
      // owned set is narrowed to exactly the identities this removal is
      // authorized to delete. A retained identity therefore appears in
      // neither list, which is how an adapter is told to leave it alone. No
      // consent is asked for either — removal withdraws authorization, it
      // never grants it.
      const refinedMcp = await prepareMcpServers({
        projectRoot,
        adapters,
        configurations: [],
        obsolete: refined.obsoleteConfigurations,
        previouslyOwnedNames: refined.obsoleteConfigurations.map((ownership) => ownership.effectiveName),
        onLog,
      })
      if (!refinedMcp.ok) {
        return failureNoMutation(refinedMcp.failure)
      }

      // Preparation is asynchronous and reads every selected adapter's native
      // configuration, so an interrupt can land inside it. Without this second
      // checkpoint the next observation is after the delete pass, which turns
      // "nothing was written" into "the project was restored" for a Ctrl-C
      // that arrived while the run was still read-only.
      if (signal?.aborted) {
        return failureNoMutation({ code: 'ABORTED' })
      }

      // The steps below mirror the resolve path's Apply and commit, minus the
      // write pass: nothing is materialized, because refinement has confirmed
      // every remaining asset is already on disk under the identity it keeps.
      // Keep the two in step.
      //
      // The ownership index comes back from the refinement rather than being
      // rebuilt here: the gates that authorized this path were checked against
      // that index, and a second build could only differ by disagreeing with
      // the decision already made.
      const transaction = new FileTransaction()
      const previousOwnership = refined.previousOwnership
      const removed = removedFacetOutcomes({ desiredFacets: merged.desiredFacets, receiptState, previousLockfile })
      for (const outcome of removed) {
        // Only a tracked removal has cleanup to announce; `removed-untracked`
        // deletes nothing, so reporting progress against it would be a lie.
        if (outcome.kind !== 'removed') continue
        onStage({ kind: 'drift-removal', facet: outcome.name, oldVersion: outcome.oldVersion })
      }

      const obsolete = obsoleteOwnership(previousOwnership, refined.materialized)
      const deletion = await deleteObsoleteAssets({
        projectRoot,
        adapters: [...adapters],
        obsolete,
        transaction,
        onLog,
      })
      if (!deletion.ok) {
        const failure = materializeFailureToRunInstall(deletion.facets[0] ?? '', deletion.failure)
        return rollbackAndFail(transaction, failure, onLog)
      }

      // Remove the obsolete native entries, journaled with their exact prior
      // bytes like every other configuration write.
      const refinedApplied = await applyMcpServers({
        prepared: refinedMcp.prepared,
        transaction,
        signal,
        onLog,
      })
      if (!refinedApplied.ok) {
        return rollbackAndFail(transaction, refinedApplied.failure, onLog)
      }

      // Second checkpoint: the deletes are done and the tri-write is next, so
      // an abort arriving now must undo them rather than commit on top. The
      // last safe moment — the tri-write is the transaction boundary, and the
      // journal cannot undo a committed one.
      if (signal?.aborted) {
        return rollbackAndFail(transaction, { code: 'ABORTED' }, onLog)
      }

      const newLockfile = preserveLockfileExtensions(previousLockfile, {
        lockfileVersion: CURRENT_LOCKFILE_VERSION,
        facets: refined.facetEntries,
      })
      const prunedIntent = finalizeMaterializationIntent(
        merged.desiredFacets,
        refined.overrides,
        refined.staleOverrides,
      )
      const committed = commitProjectFiles({
        projectRoot,
        manifestDocument: projectManifest.document,
        desiredFacets: merged.desiredFacets,
        lockedSet: { kind: 'write', newLockfile },
        // Nothing was written, so the receipt can only be PRUNED — never
        // re-derived from lockfile entries this run did not apply.
        newReceipt: buildUpdatedReceipt(receiptPath, { kind: 'carried-forward', facets: refined.receiptFacets }),
        loadedStates,
        transaction,
        onLog,
      })
      if (!committed.ok) {
        return rollbackAndFail(transaction, committed.failure, onLog)
      }
      onStage({ kind: 'lockfile-write', path: join(projectRoot, FACETS_LOCK_FILE) })
      for (const entry of prunedIntent) {
        onStage({
          kind: 'stale-override-pruned',
          facet: entry.facet,
          contribution: entry.contribution,
          authoredName: entry.authoredName,
        })
      }

      // Removal reconciles ownership without resolving anything, so it has no
      // declarations to report a disposition for and no approval to record.
      // What it does have is the native entries it just dropped.
      const refinedOutcomes: McpInstallOutcomes = {
        ...NO_MCP_OUTCOMES,
        configurations: classifyMcpConfigurations({
          configurations: [],
          previousOwnership: refined.previousMcpOwnership,
          prepared: refinedMcp.prepared,
        }),
        prunedIntent: prunedServerIntent(prunedIntent),
      }
      reportMcpConfigured(refinedOutcomes.configurations)
      onStage({ kind: 'install-complete', outcome: 'success' })

      const perFacetOutcomes = [...refined.outcomes, ...removed]
      return {
        ok: true,
        lockfile: newLockfile,
        summary: summarize(perFacetOutcomes, 0, deletion.deleted, refinedOutcomes),
        perFacet: perFacetOutcomes,
        mcp: refinedOutcomes,
      }
    }

    onStage({ kind: 'install-start', totalFacets: Object.keys(merged.desiredFacets).length })

    // 6. Resolve every desired facet. Nothing is written during this phase,
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
    const { resolved } = resolution.value

    // 7. Compose the global plan. Still no journal and still nothing
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

    // 7a0. Frozen server intent. Runs here rather than in the pre-fetch gate
    //      because whether an override still names a declaration the facet
    //      publishes is only knowable from the verified archive. Still ahead
    //      of everything that mutates: a frozen run that refuses has not
    //      deleted, written, or reconciled anything first.
    if (frozenLockfile) {
      const staleServerIntent = checkFrozenServerIntent(plan.staleOverrides)
      if (staleServerIntent !== null) {
        return failureNoMutation(staleServerIntent)
      }
    }

    // 7a. The MCP configuration ownership index, built from the receipt
    //     STATE. Needed here — before the journal — because both remaining
    //     pre-mutation steps read it: preparation needs the exact set of
    //     effective names an adapter is authorized to remove, and consent
    //     needs the approval evidence recorded at each identity. A receipt
    //     that predates configuration claims yields an empty index, which is
    //     the safe answer in both directions: nothing is deletable, and every
    //     declaration needs approval.
    const previousMcpOwnership = buildPreviousMcpOwnership(receiptState)
    const obsoleteConfigurations = obsoleteMcpOwnership(previousMcpOwnership, plan.mcpServers.configurations)

    // 7b. Verify every selected adapter can do this project's MCP work, then
    //     ask each to prepare its complete native change read-only. Both run
    //     on the no-mutation path, before the journal and before any prompt:
    //     an unsupported adapter must not consume an approval it cannot
    //     honor, and a user cannot be asked to approve a change nothing has
    //     computed yet.
    const preparedMcp = await prepareMcpServers({
      projectRoot,
      adapters,
      configurations: plan.mcpServers.configurations,
      obsolete: obsoleteConfigurations,
      previouslyOwnedNames: previouslyOwnedServerNames(previousMcpOwnership),
      onLog,
    })
    if (!preparedMcp.ok) {
      return failureNoMutation(preparedMcp.failure)
    }

    // Same checkpoint as the refined path, and for the same reason. The
    // existing check below covers only an abort during the approval screen, so
    // an operation whose consent was already satisfied went from this
    // asynchronous read straight into the journal and the delete pass.
    if (signal?.aborted) {
      return failureNoMutation({ code: 'ABORTED' })
    }

    // 7c. MCP configuration consent. Approval authorizes execution — a
    //     command this machine will hand a tool to run, or an endpoint it
    //     will connect to — so it is asked per machine, from the receipt's
    //     own approval evidence, and never inherited from a teammate's
    //     commit. Still before the journal: declining costs nothing to undo.
    const consent = deriveMcpConsent({
      configurations: plan.mcpServers.configurations,
      previousOwnership: previousMcpOwnership,
      prepared: preparedMcp.prepared,
    })
    let mcpConsentOutcome: McpConsentOutcome = { kind: 'not-required' }
    if (consent.kind === 'required') {
      // Frozen mode reproduces recorded intent and must never collect a new
      // decision, not even from a human at a terminal. The CLI already
      // withholds the resolver; this is the defense-in-depth half, mirroring
      // the collision resolver's own frozen guard.
      const policy: McpConsentPolicy =
        frozenLockfile && mcpConsent.kind === 'interactive' ? { kind: 'unavailable' } : mcpConsent
      const summary = summarizeMcpConsentRequest(consent.request)
      onStage({ kind: 'mcp-consent-required', request: summary })
      const settled = await settleMcpConsent(policy, consent.request)
      if (settled.kind === 'unavailable') {
        return failureNoMutation({ code: 'MCP_CONSENT_REQUIRED', request: consent.request })
      }
      // An abort arriving while the screen was open settles it as declined;
      // the signal is the honest account of what happened, so it is read
      // first rather than adding a third decision arm for the same fact.
      if (signal?.aborted) {
        return failureNoMutation({ code: 'ABORTED' })
      }
      if (settled.kind === 'declined') {
        onStage({ kind: 'mcp-consent-declined' })
        return failureNoMutation({ code: 'MCP_CONSENT_DECLINED', request: summary })
      }
      // `preapproved` is the only arm that answers without asking, so it is
      // the only one that can report an approval nobody read.
      const via = policy.kind === 'preapproved' ? 'preapproved' : 'interactive'
      onStage({ kind: 'mcp-consent-accepted', via })
      mcpConsentOutcome = { kind: 'accepted', via, request: summary }
    }

    // 7. The first mutation is now imminent, so the rollback ledger opens
    //    here. Every entry it accumulates corresponds to a write that
    //    actually happened.
    const transaction = new FileTransaction()

    // 7a. Index what this machine can PROVE it has, keyed by EFFECTIVE adapter
    //     identity rather than by facet. Both halves of Apply read it: the
    //     delete pass to find owned identities nothing wants any more, the
    //     write pass to learn which owned companion paths a replacement may
    //     remove. Built from the receipt STATE alone — the desired set
    //     authorizes writes, but only this index authorizes deletion, and an
    //     unusable receipt yields an empty index by construction.
    const previousOwnership = buildPreviousOwnership(receiptState)

    // 7b. Facets being dropped, for the summary. Computed before the delete
    //     pass so the progress events precede the work they describe; the
    //     deletion itself is global, not per facet.
    const removedOutcomes = removedFacetOutcomes({
      desiredFacets: merged.desiredFacets,
      receiptState,
      previousLockfile,
    })
    for (const outcome of removedOutcomes) {
      // See the refined path: an untracked removal has no cleanup to report.
      if (outcome.kind !== 'removed') continue
      onStage({ kind: 'drift-removal', facet: outcome.name, oldVersion: outcome.oldVersion })
    }

    // 8. Apply, pass 1: delete every obsolete effective identity, once.
    //    Deletes precede writes globally so a name transferring between
    //    facets is never deleted after its new owner has written it, and an
    //    identity still claimed by any desired asset is retained outright.
    const obsolete = obsoleteOwnership(previousOwnership, plan.materialized)
    const deletion = await deleteObsoleteAssets({
      projectRoot,
      adapters: [...adapters],
      obsolete,
      transaction,
      onLog,
    })
    if (!deletion.ok) {
      const failure = materializeFailureToRunInstall(deletion.facets[0] ?? '', deletion.failure)
      return rollbackAndFail(transaction, failure, onLog)
    }

    if (signal?.aborted) {
      return rollbackAndFail(transaction, { code: 'ABORTED' }, onLog)
    }

    // 9. Apply, pass 2: write every desired asset under its effective name.
    const loop = await installFacets({
      resolved,
      plan,
      previousOwnership,
      projectRoot,
      adapters,
      transaction,
      // Frozen mode reproduces recorded intent and never collects a new
      // decision, so the gate is withheld and reconciliation continues
      // exactly as it did before — the same rule the collision resolver and
      // MCP consent follow.
      ...(resolveAssetTakeover && !frozenLockfile ? { resolveAssetTakeover } : {}),
      signal,
      onStage,
      onLog,
    })
    if (!loop.ok) {
      return rollbackAndFail(transaction, loop.failure, onLog)
    }
    const { newFacetEntries, assetWrites, totalAssets } = loop.value

    // 10. Apply every prepared native MCP plan, last of the mutations and
    //     immediately before the transaction commits. Each changed document
    //     is journaled with its exact prior bytes, so a tri-write failure or
    //     an abort arriving now walks configuration and assets back together
    //     in one LIFO replay.
    const appliedMcp = await applyMcpServers({
      prepared: preparedMcp.prepared,
      transaction,
      signal,
      onLog,
    })
    if (!appliedMcp.ok) {
      return rollbackAndFail(transaction, appliedMcp.failure, onLog)
    }

    // What this run actually reconciled. Every active configuration was —
    // each adapter either wrote it or proved the native state already matched
    // — and approval for all of them was obtained above, which is what makes
    // a claim assert two true things rather than one.
    //
    // Zero capable adapters with a non-empty desired set is not that: nothing
    // reconciled it, so nothing may claim it.
    const reconciledServerConfigurations: readonly PlannedServerConfiguration[] =
      preparedMcp.prepared.length > 0 ? plan.mcpServers.configurations : []

    if (signal?.aborted) {
      return rollbackAndFail(transaction, { code: 'ABORTED' }, onLog)
    }

    // 9. Transactional tri-write: manifest + lockfile + receipt (receipt
    //    only under frozen). The manifest-write policy (bare → pin,
    //    explicit → verbatim) is applied just before the write.
    //
    //    Version migration (design D10): a normal install always writes the
    //    current schema, migrating a `0.2` lockfile after every resolved
    //    artifact has passed verification. Frozen mode never rewrites the
    //    lockfile, so it retains the version the file was loaded under.
    //    Extension carry-through (`preserveLockfileExtensions`): the entries
    //    above are rebuilt from resolved state, so anything the previous
    //    document carried that this implementation does not model would be
    //    dropped by the rewrite — including across the migration. The
    //    published contract says unrecognized fields are preserved, and until
    //    now only LOADING honored it.
    const lockedSet: LockedSetCommit = frozenLockfile
      ? { kind: 'retain' }
      : {
          kind: 'write',
          newLockfile: preserveLockfileExtensions(previousLockfile, {
            lockfileVersion: CURRENT_LOCKFILE_VERSION,
            facets: newFacetEntries,
          }),
        }
    // A claim asserts BOTH that an identity was reconciled and that its
    // declaration was approved here, which is why it is derived from what the
    // apply step did rather than from the composed plan.
    const newReceipt = buildUpdatedReceipt(receiptPath, {
      kind: 'written',
      facetEntries: newFacetEntries,
      configurations: claimsByFacet(reconciledServerConfigurations),
    })
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
      loadedStates,
      transaction,
      onLog,
    })
    if (!written.ok) {
      return rollbackAndFail(transaction, written.failure, onLog)
    }
    if (written.receipt === 'unpersisted') {
      onLog(() => `[warn] install receipt could not be written (${written.cause}); this run's assets stay untracked`)
      onStage({ kind: 'receipt-unpersisted', cause: written.cause })
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
        contribution: entry.contribution,
        authoredName: entry.authoredName,
      })
    }

    // Same rule for configuration outcomes: the reconciliation is not real
    // until the tri-write above commits, so nothing is announced before it.
    const mcp: McpInstallOutcomes = {
      consent: mcpConsentOutcome,
      dispositions: classifyMcpDispositions(plan.mcpServers.planned, mcpIntentBaseline(receiptState)),
      configurations: classifyMcpConfigurations({
        configurations: reconciledServerConfigurations,
        previousOwnership: previousMcpOwnership,
        prepared: preparedMcp.prepared,
      }),
      prunedIntent: prunedServerIntent(pruned),
    }
    reportMcpConfigured(mcp.configurations)

    // Classified here rather than inside the write loop, because a facet's
    // outcome is not knowable until its configuration has been reconciled
    // too: a server-only facet writes no asset at all, and a declaration
    // whose native entry had drifted is a repair the loop cannot see.
    const configurationWork = facetConfigurationWork(mcp)
    const perFacet: FacetOutcome[] = []
    for (const record of resolved) {
      // Composed entries are the authority on what was locked, including the
      // dispositions this run applied. A facet the plan does not carry was
      // never composed and so has nothing to classify.
      const composedEntry = plan.facetEntries[record.facet]
      if (composedEntry === undefined) continue
      const outcome = classifyOutcome(
        record.facet,
        record.previousEntry,
        composedEntry,
        assetWrites.get(record.facet) ?? 0,
        configurationWork.get(record.facet) ?? NO_CONFIGURATION_WORK,
      )
      perFacet.push(outcome)
      onStage({ kind: 'facet-success', facet: record.facet, outcome })
    }
    perFacet.push(...removedOutcomes)

    onStage({ kind: 'install-complete', outcome: 'success' })

    return {
      ok: true,
      // Frozen retained the file on disk, so the previous lockfile IS the
      // current one — reporting the composed set would claim a write that
      // never happened.
      lockfile: lockedSet.kind === 'write' ? lockedSet.newLockfile : previousLockfile,
      // `deletion.deleted` counts identities that actually existed on disk,
      // across every adapter — not a per-facet estimate multiplied out.
      summary: summarize(perFacet, totalAssets, deletion.deleted, mcp),
      perFacet,
      mcp,
    }
  } finally {
    await installLock.release()
  }

  function noopStage(_event: StageEvent): void {}
  function noopLog(_build: () => string): void {}

  /**
   * The server half of what a successful commit pruned.
   *
   * Both domains prune through one pass over one override document, so the
   * split happens here rather than by running the prune twice. Assets already
   * have somewhere to be reported; servers did not until now.
   */
  function prunedServerIntent(pruned: readonly PrunedOverride[]): PrunedServerIntent[] {
    return pruned
      .filter((entry) => entry.contribution.kind === 'mcp-server')
      .map((entry) => ({ facet: entry.facet, authoredName: entry.authoredName }))
  }

  /**
   * Announce obsolete bundles whose cleanup was skipped because their primary
   * was already gone. Called only after the project files commit: before that
   * the removal can still roll back, and the files are still tracked.
   */

  /**
   * Announce every effective identity this operation reconciled, after the
   * transaction has committed. Same rule as the retained-bundle and
   * stale-override reports: until the tri-write succeeds, a configuration
   * write is still a candidate for rollback.
   */
  function reportMcpConfigured(outcomes: readonly McpConfigurationOutcome[]): void {
    for (const outcome of outcomes) {
      onStage({ kind: 'mcp-configured', outcome })
    }
  }

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
        reason: 'post-lock-no-mutation',
      },
    }
  }
}
