import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FileMutation, FileState } from '@agent-facets/common'
import { inspectFileState } from '@agent-facets/common'
import type { CurrentLockfile, CurrentLockfileFacet } from '@agent-facets/protocol'
import { facetReceiptsDir } from '../../facet-dir.ts'
import type { FileTransaction } from '../../fs/index.ts'
import { jsonFileText } from '../../json-file-text.ts'
import {
  applyDesiredFacets,
  FACETS_JSON_FILE,
  type ManifestDocument,
  type NormalizedFacetEntry,
  serializeProjectManifest,
} from '../../manifest/mutations.ts'
import { canonicalLockfileText, FACETS_LOCK_FILE } from '../lockfile-io.ts'
import { ownEntry, ownRecord } from '../own-entry.ts'
import {
  CURRENT_RECEIPT_VERSION,
  canonicalProjectPath,
  type Receipt,
  type ReceiptConfigurationClaim,
  type ReceiptFacetEntry,
  receiptEntryForLockedFacet,
  receiptPath,
} from '../receipt.ts'
import type { OnLog, RunInstallFailure } from '../types.ts'

/**
 * What this run knows about the assets now on disk — the only input from
 * which a new receipt may be derived.
 *
 *   - `written` — this run materialized these facets from these very lockfile
 *     entries, so the entries describe what it just reconciled: wrote, or
 *     read and proved already identical. Deriving the receipt from them is an
 *     observation, not a guess.
 *   - `carried-forward` — this run wrote nothing. The receipt entries were
 *     already witnessed against local state (see `refineRemoval`) and are
 *     committed verbatim.
 *
 * Tagged rather than "a map of lockfile entries, and separately a promise
 * that they were written": a path that materializes nothing could otherwise
 * hand over entries it never applied, and the receipt would then claim an
 * effective identity no file on this machine has.
 */
export type MaterializedReceiptState =
  | {
      kind: 'written'
      facetEntries: Readonly<Record<string, CurrentLockfileFacet>>
      /**
       * The MCP configuration claims this run reconciled, keyed by facet.
       * Separate from `facetEntries` because the lockfile records no
       * declarations, so there is nothing in a locked entry to derive a claim
       * from — it can only come from what was actually applied.
       */
      configurations: Readonly<Record<string, readonly ReceiptConfigurationClaim[]>>
    }
  | { kind: 'carried-forward'; facets: Readonly<Record<string, ReceiptFacetEntry>> }

/**
 * Derive the new receipt from what this run actually put on disk. The receipt
 * records, per facet, the resolved integrity plus the assets and MCP
 * configuration claims it owns — a self-sufficient, offline-capable deletion
 * record for future drift removal. It mirrors asset paths, never hashes, and
 * declaration fingerprints, never declarations.
 */
export function buildUpdatedReceipt(projectPath: string, state: MaterializedReceiptState): Receipt {
  const facets: Record<string, ReceiptFacetEntry> = ownRecord()
  if (state.kind === 'carried-forward') {
    for (const [name, entry] of Object.entries(state.facets)) {
      facets[name] = entry
    }
    return { version: CURRENT_RECEIPT_VERSION, path: projectPath, facets }
  }
  for (const [name, entry] of Object.entries(state.facetEntries)) {
    facets[name] = receiptEntryForLockedFacet(entry, ownEntry(state.configurations, name) ?? [])
  }
  return { version: CURRENT_RECEIPT_VERSION, path: projectPath, facets }
}

/**
 * The outcome of the commit's write step.
 *
 *   - `persisted` — the files this mode writes all landed, receipt included.
 *   - `unpersisted` — frozen mode materialized assets but could not record
 *     them. The operation still succeeded: the locked set on disk is
 *     untouched and correct, and refusing here would fail a reproduction over
 *     machine-local bookkeeping. But the consequence outlives the command —
 *     every identity this run wrote is now untracked, so nothing can clean it
 *     up later — which is why the reason travels in the result instead of
 *     being swallowed.
 */
export type TriWriteResult =
  | { ok: true; receipt: 'persisted' }
  | { ok: true; receipt: 'unpersisted'; cause: string }
  | { ok: false; failure: RunInstallFailure }

/**
 * What this commit does to the locked set (`facets.json` + `facets.lock`).
 *
 *   - `write` — a normal install. Both files are rewritten, and the
 *     lockfile is always the CURRENT schema.
 *   - `retain` — frozen mode. Neither file is touched, so the lockfile on
 *     disk keeps whatever version it was loaded under.
 */
export type LockedSetCommit = { kind: 'write'; newLockfile: CurrentLockfile } | { kind: 'retain' }

export interface TriWriteArgs {
  projectRoot: string
  /**
   * The live comment-preserving manifest document. Mutated in place here —
   * never rebuilt — so comments survive the write.
   */
  manifestDocument: ManifestDocument
  desiredFacets: Readonly<Record<string, NormalizedFacetEntry>>
  lockedSet: LockedSetCommit
  newReceipt: Receipt
  /**
   * The exact states these files were loaded in.
   *
   * The commit is conditional on them: a manifest a teammate's editor rewrote
   * while this install was resolving is not the manifest this plan was
   * computed from, and writing over it would discard their edit as silently
   * as it would discard ours.
   */
  loadedStates: ProjectFileStates
  transaction: FileTransaction
  onLog?: OnLog
}

/**
 * The machine-local receipt's state, or the fact that it could not be read.
 *
 * Separated from the other two because the consequence differs: a project
 * whose manifest cannot be read has nothing to install from, while a receipt
 * that cannot be read costs only bookkeeping — and frozen mode, which
 * reproduces a locked set it has already verified, must not fail over it.
 */
export type ReceiptFileState = { readable: true; state: FileState } | { readable: false; cause: string }

/** The three project files, as they stood when this run read them. */
export interface ProjectFileStates {
  manifest: FileState
  lockfile: FileState
  receipt: ReceiptFileState
}

/**
 * Read the exact current state of the three project files.
 *
 * Called once, before the run mutates anything, so the commit can state the
 * precondition it was computed from. A file that cannot be inspected is
 * reported now rather than at commit time, when assets are already on disk.
 */
export function readProjectFileStates(
  projectRoot: string,
): { ok: true; states: ProjectFileStates; receiptFile: string } | { ok: false; failure: RunInstallFailure } {
  let receiptFile: string
  try {
    receiptFile = receiptPath(projectRoot)
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: 'LOCKFILE_WRITE_FAILED',
        path: projectRoot,
        cause: `could not resolve the receipt path: ${error instanceof Error ? error.message : String(error)}`,
      },
    }
  }

  const locked: Array<[key: 'manifest' | 'lockfile', path: string]> = [
    ['manifest', join(projectRoot, FACETS_JSON_FILE)],
    ['lockfile', join(projectRoot, FACETS_LOCK_FILE)],
  ]
  const states: Partial<Pick<ProjectFileStates, 'manifest' | 'lockfile'>> = {}
  for (const [key, path] of locked) {
    const inspected = inspectFileState(path)
    if (!inspected.ok) {
      return {
        ok: false,
        failure: { code: 'LOCKFILE_WRITE_FAILED', path, cause: `could not read the current contents of ${path}` },
      }
    }
    states[key] = inspected.state
  }

  const inspectedReceipt = inspectFileState(receiptFile)
  const receipt: ReceiptFileState = inspectedReceipt.ok
    ? { readable: true, state: inspectedReceipt.state }
    : { readable: false, cause: `could not read the current contents of ${receiptFile}` }

  const { manifest, lockfile } = states
  if (manifest === undefined || lockfile === undefined) {
    // Unreachable: the loop assigns both keys or returns.
    throw new Error('readProjectFileStates: expected one state per locked-set file')
  }
  return { ok: true, states: { manifest, lockfile, receipt }, receiptFile }
}

const encoder = new TextEncoder()

/**
 * The commit's final write step.
 *
 * Frozen mode writes the receipt ONLY — materialization state converges, but
 * the locked set (manifest + lockfile) is never written. A receipt write
 * failure under frozen does not fail the operation — the locked set it
 * reproduced is intact — but it is reported through the result rather than
 * swallowed, because the files this run wrote are untracked from here on.
 *
 * Non-frozen mode commits all three files as ONE batch. Either all of them
 * land or none does: a manifest written while the lockfile is not describes a
 * project state that never existed, and the batch is what makes that
 * unrepresentable rather than merely unlikely.
 */
export function commitProjectFiles(args: TriWriteArgs): TriWriteResult {
  const { projectRoot, lockedSet, newReceipt, loadedStates, transaction } = args

  const receiptFile = receiptPath(projectRoot)
  const canonical = canonicalProjectPath(projectRoot)
  const receiptBytes = encoder.encode(jsonFileText({ ...newReceipt, path: canonical }))

  // The receipts directory is machine-local bookkeeping outside the project,
  // created up front so the batch's own boundary can be the directory itself.
  try {
    mkdirSync(facetReceiptsDir(), { recursive: true })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    if (lockedSet.kind === 'retain') return { ok: true, receipt: 'unpersisted', cause }
    return { ok: false, failure: { code: 'LOCKFILE_WRITE_FAILED', path: receiptFile, cause } }
  }

  if (!loadedStates.receipt.readable) {
    // Frozen mode reproduced a locked set it already verified; refusing over
    // machine-local bookkeeping would fail a correct reproduction. Non-frozen
    // has a locked set to write and a rollback to run, so it reports.
    if (lockedSet.kind === 'retain') return { ok: true, receipt: 'unpersisted', cause: loadedStates.receipt.cause }
    return {
      ok: false,
      failure: { code: 'LOCKFILE_WRITE_FAILED', path: receiptFile, cause: loadedStates.receipt.cause },
    }
  }

  const receiptMutation: FileMutation = {
    kind: 'write',
    path: receiptFile,
    boundary: dirname(receiptFile),
    expected: loadedStates.receipt.state,
    contents: receiptBytes,
  }

  if (lockedSet.kind === 'retain') {
    const applied = transaction.apply({ kind: 'mutate', mutations: [receiptMutation] })
    if (!applied.ok) {
      return { ok: true, receipt: 'unpersisted', cause: describeTransactionRefusal(receiptFile) }
    }
    args.onLog?.(() => `[verbose]   wrote receipt (${receiptFile}) [frozen]`)
    return { ok: true, receipt: 'persisted' }
  }

  // In-place mutation, not reconstruction: comment-json keeps comment metadata
  // on non-enumerable symbols that an object spread would silently drop. This
  // also stamps the current `manifestVersion`, migrating a legacy document as
  // part of the same transaction.
  applyDesiredFacets(args.manifestDocument, args.desiredFacets)

  const manifestPath = join(projectRoot, FACETS_JSON_FILE)
  const lockfilePath = join(projectRoot, FACETS_LOCK_FILE)
  const applied = transaction.apply({
    kind: 'mutate',
    mutations: [
      {
        kind: 'write',
        path: manifestPath,
        boundary: projectRoot,
        expected: loadedStates.manifest,
        contents: encoder.encode(serializeProjectManifest(args.manifestDocument)),
      },
      {
        kind: 'write',
        path: lockfilePath,
        boundary: projectRoot,
        expected: loadedStates.lockfile,
        contents: encoder.encode(canonicalLockfileText(lockedSet.newLockfile)),
      },
      receiptMutation,
    ],
  })
  if (!applied.ok) {
    return {
      ok: false,
      failure: {
        code: 'FILESYSTEM_TRANSACTION_FAILED',
        subject: { kind: 'project-files' },
        failure: applied.failure,
      },
    }
  }

  for (const path of applied.applied) {
    args.onLog?.(() => `[verbose]   wrote ${path}`)
  }
  return { ok: true, receipt: 'persisted' }
}

function describeTransactionRefusal(path: string): string {
  return `the receipt at ${path} could not be written`
}
