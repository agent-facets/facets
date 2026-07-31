import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CurrentLockfile, CurrentLockfileFacet } from '@agent-facets/protocol'
import { applyDesiredFacets, type ManifestDocument, type NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { writeProjectManifest } from '../../manifest/project-files.ts'
import { FACETS_LOCK_FILE, writeLockfile } from '../lockfile-io.ts'
import { ownRecord } from '../own-entry.ts'
import {
  type Receipt,
  type ReceiptFacetEntry,
  receiptEntryForLockedFacet,
  receiptPath,
  writeReceipt,
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
 * effective identity no file on this machine has. Ownership reconciliation
 * trusts the receipt, so that claim is not a cosmetic inaccuracy — it strands
 * the real file permanently.
 */
export type MaterializedReceiptState =
  | { kind: 'written'; facetEntries: Readonly<Record<string, CurrentLockfileFacet>> }
  | { kind: 'carried-forward'; facets: Readonly<Record<string, ReceiptFacetEntry>> }

/**
 * Derive the new receipt from what this run actually put on disk. The receipt
 * records `{ version, assets[] }` per facet, each asset carrying the owned
 * inner-archive file paths — a self-sufficient, offline-capable deletion
 * record for future drift removal. It mirrors paths, never hashes.
 */
export function buildUpdatedReceipt(receipt: Receipt, state: MaterializedReceiptState): Receipt {
  const facets: Record<string, ReceiptFacetEntry> = ownRecord()
  if (state.kind === 'carried-forward') {
    for (const [name, entry] of Object.entries(state.facets)) {
      facets[name] = entry
    }
    return { ...receipt, facets }
  }
  for (const [name, entry] of Object.entries(state.facetEntries)) {
    facets[name] = receiptEntryForLockedFacet(entry)
  }
  return { ...receipt, facets }
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
 *     being swallowed. Only frozen mode can produce it; the non-frozen trio
 *     rolls back instead.
 */
export type TriWriteResult =
  | { ok: true; receipt: 'persisted' }
  | { ok: true; receipt: 'unpersisted'; cause: string }
  | { ok: false; failure: RunInstallFailure }

/**
 * What this commit does to the locked set (`facets.json` + `facets.lock`).
 *
 *   - `write` — a normal install. Both files are rewritten, and the
 *     lockfile is always the CURRENT schema: this is where a `0.2` document
 *     migrates forward, after every artifact this run resolved has passed
 *     verification — or, on the removal-only refinement path, after the
 *     remaining entries have been carried forward from local state without
 *     being re-resolved at all.
 *   - `retain` — frozen mode. Neither file is touched, so the lockfile on
 *     disk keeps whatever version it was loaded under.
 *
 * Frozen carries no lockfile value at all, rather than a value flagged
 * "don't write me". Previously the caller synthesized one with the loaded
 * version and inherited entries purely to satisfy the parameter, producing
 * a document that could not have been written and was never meant to be.
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
  onLog?: OnLog
}

/**
 * The commit's final write step.
 *
 * Frozen mode writes the receipt ONLY — materialization state
 * converges, but the locked set (manifest + lockfile) is never
 * written. A receipt write failure under frozen does not fail the
 * operation — the locked set it reproduced is intact — but it is
 * reported through the result rather than swallowed, because the files
 * this run wrote are untracked from here on.
 *
 * Non-frozen mode writes all three files — `facets.json`,
 * `facets.lock`, and the receipt — as one transaction. Disk I/O can
 * fail (EACCES, ENOSPC, EIO) at any point in the trio; a mid-trio
 * failure must not leave the manifest written while the lockfile and
 * receipt are not. Byte pre-images of all three files (or their
 * absence) are captured immediately before the first write; on any
 * failure every file is restored byte-for-byte (files that did not
 * exist are deleted) and the failure is reported as
 * `LOCKFILE_WRITE_FAILED` so the caller can roll back materialization.
 */
export function commitProjectFiles(args: TriWriteArgs): TriWriteResult {
  const { projectRoot, lockedSet, newReceipt } = args

  if (lockedSet.kind === 'retain') {
    try {
      writeReceipt(projectRoot, newReceipt)
    } catch (error) {
      return { ok: true, receipt: 'unpersisted', cause: describeError(error) }
    }
    args.onLog?.(() => `[verbose]   wrote receipt (${receiptPath(projectRoot)}) [frozen]`)
    return { ok: true, receipt: 'persisted' }
  }

  // Resolve the receipt path and capture pre-images right before the trio, so
  // a mid-trio failure can restore all three files exactly as they were.
  //
  // Both steps can fail on a disk that has moved under the run — an
  // unresolvable project root, a file that exists but cannot be read — and
  // both used to escape as a throw, out of a function whose contract is to
  // return and at a point where materialization has already happened. The
  // caller never got the chance to replay the journal. They are failures like
  // any other write failure now.
  const prepared = prepareTriWrite(projectRoot)
  if (!prepared.ok) return { ok: false, failure: prepared.failure }
  const { receiptFile, preImages } = prepared

  // Each write is wrapped individually so a mid-trio failure identifies
  // which file threw. The pre-image restore always runs for all three
  // files regardless of which one failed, preserving the all-or-nothing
  // guarantee.
  const writes: Array<{ file: 'manifest' | 'lockfile' | 'receipt'; path: string; fn: () => void }> = [
    {
      file: 'manifest',
      path: join(projectRoot, 'facets.json'),
      fn: () => {
        // In-place mutation, not reconstruction: comment-json keeps comment
        // metadata on non-enumerable symbols that an object spread would
        // silently drop. This also stamps the current `manifestVersion`,
        // migrating a legacy document as part of the same transaction.
        applyDesiredFacets(args.manifestDocument, args.desiredFacets)
        writeProjectManifest(projectRoot, args.manifestDocument)
      },
    },
    {
      file: 'lockfile',
      path: join(projectRoot, FACETS_LOCK_FILE),
      fn: () => writeLockfile(projectRoot, lockedSet.newLockfile),
    },
    {
      file: 'receipt',
      path: receiptFile,
      fn: () => writeReceipt(projectRoot, newReceipt),
    },
  ]

  for (const write of writes) {
    try {
      write.fn()
      args.onLog?.(() => `[verbose]   wrote ${write.file} (${write.path})`)
    } catch (error) {
      for (const image of preImages) {
        restorePreImage(image)
      }
      return {
        ok: false,
        failure: {
          code: 'LOCKFILE_WRITE_FAILED',
          path: write.path,
          cause: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
  return { ok: true, receipt: 'persisted' }
}

/**
 * Byte pre-image of a project file. `bytes: null` records absence —
 * restoring an absent pre-image deletes the file.
 */
interface FilePreImage {
  path: string
  bytes: Buffer | null
}

/**
 * Everything the trio needs that can fail before its first write: the
 * receipt's location, and a pre-image of each of the three files.
 */
function prepareTriWrite(
  projectRoot: string,
): { ok: true; receiptFile: string; preImages: FilePreImage[] } | { ok: false; failure: RunInstallFailure } {
  let receiptFile: string
  try {
    receiptFile = receiptPath(projectRoot)
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: 'LOCKFILE_WRITE_FAILED',
        path: projectRoot,
        cause: `could not resolve the receipt path: ${describeError(error)}`,
      },
    }
  }

  const preImages: FilePreImage[] = []
  for (const path of [join(projectRoot, 'facets.json'), join(projectRoot, FACETS_LOCK_FILE), receiptFile]) {
    const captured = capturePreImage(path)
    if (!captured.ok) {
      return { ok: false, failure: { code: 'LOCKFILE_WRITE_FAILED', path, cause: captured.cause } }
    }
    preImages.push(captured.image)
  }
  return { ok: true, receiptFile, preImages }
}

/**
 * Read a file's current bytes, or record that it does not exist.
 *
 * Only the "not there" errno family means absence. Every other read failure —
 * EACCES, EIO, a path that turned into a directory — is reported, because
 * treating it as absence would arm a restore that DELETES a file this run
 * could not read, turning an unreadable manifest into a lost one.
 */
function capturePreImage(path: string): { ok: true; image: FilePreImage } | { ok: false; cause: string } {
  try {
    return { ok: true, image: { path, bytes: readFileSync(path) } }
  } catch (error) {
    if (isMissingFile(error)) return { ok: true, image: { path, bytes: null } }
    return { ok: false, cause: `could not read the current contents: ${describeError(error)}` }
  }
}

/** ENOENT/ENOTDIR — the "file is not there" errno family. */
function isMissingFile(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Best-effort restore. The restore runs on a disk that just failed a
 * write, so it may fail too; swallowing here is deliberate — the
 * journal rollback and the structured failure still report the commit
 * as failed, and a partially-restored file is no worse than the
 * mid-trio state the restore is repairing.
 */
function restorePreImage(image: FilePreImage): void {
  try {
    if (image.bytes === null) {
      rmSync(image.path, { force: true })
    } else {
      writeFileSync(image.path, image.bytes)
    }
  } catch {
    // Best-effort by design (see doc comment).
  }
}
