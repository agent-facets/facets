import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type CurrentLockfile, type CurrentLockfileFacet, isMaterialized } from '@agent-facets/protocol'
import { applyDesiredFacets, type ManifestDocument, type NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { writeProjectManifest } from '../../manifest/project-files.ts'
import { FACETS_LOCK_FILE, writeLockfile } from '../lockfile-io.ts'
import {
  ownedPathsForLockedAsset,
  type Receipt,
  type ReceiptAsset,
  type ReceiptFacetEntry,
  receiptPath,
  writeReceipt,
} from '../receipt.ts'
import type { OnLog, RunInstallFailure } from '../types.ts'

/**
 * Derive the new receipt from the entries this run resolved. The receipt
 * records `{ version, assets[] }` per facet, each asset carrying the owned
 * inner-archive file paths mirrored from the lockfile — a self-sufficient,
 * offline-capable deletion record for future drift removal. Paths come from
 * the current lockfile asset's `files[]`; the receipt mirrors the paths and
 * never the hashes.
 */
export function buildUpdatedReceipt(
  receipt: Receipt,
  newFacetEntries: Readonly<Record<string, CurrentLockfileFacet>>,
): Receipt {
  const facets: Record<string, ReceiptFacetEntry> = {}
  for (const [name, entry] of Object.entries(newFacetEntries)) {
    // Omitted assets are recorded in the lockfile (which describes the
    // resolved SET) but never in the receipt (which describes what is on
    // disk). Including them would claim ownership of unwritten files.
    const assets: ReceiptAsset[] = []
    for (const asset of entry.assets) {
      if (!isMaterialized(asset.materialization)) continue
      assets.push({
        scope: asset.scope,
        type: asset.type,
        name: asset.name,
        materialization: asset.materialization,
        files: ownedPathsForLockedAsset(asset),
      })
    }
    facets[name] = { version: entry.version, assets }
  }
  return { ...receipt, facets }
}

export type TriWriteResult = { ok: true } | { ok: false; failure: RunInstallFailure }

/**
 * What this commit does to the locked set (`facets.json` + `facets.lock`).
 *
 *   - `write` — a normal install. Both files are rewritten, and the
 *     lockfile is always the CURRENT schema: this is where a legacy or
 *     `0.2` document migrates forward, after every resolved artifact has
 *     passed verification.
 *   - `retain` — frozen mode. Neither file is touched, so the lockfile on
 *     disk keeps whatever version it was loaded under.
 *
 * Frozen carries no lockfile value at all, rather than a value flagged
 * "don't write me". Previously the caller synthesized one with the loaded
 * version and possibly-legacy inherited entries purely to satisfy the
 * parameter, producing a document that could not have been written and was
 * never meant to be.
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
 * written. A receipt write failure under frozen is non-fatal: the
 * receipt is machine-local convenience state, not the locked set.
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
      args.onLog?.(() => `[verbose]   wrote receipt (${receiptPath(projectRoot)}) [frozen]`)
    } catch {
      // Non-fatal by design (see doc comment).
    }
    return { ok: true }
  }

  // Capture pre-images right before the trio so a mid-trio failure can
  // restore all three files exactly as they were.
  const preImages = [
    capturePreImage(join(projectRoot, 'facets.json')),
    capturePreImage(join(projectRoot, FACETS_LOCK_FILE)),
    capturePreImage(receiptPath(projectRoot)),
  ]

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
      path: receiptPath(projectRoot),
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
  return { ok: true }
}

/**
 * Byte pre-image of a project file. `bytes: null` records absence —
 * restoring an absent pre-image deletes the file.
 */
interface FilePreImage {
  path: string
  bytes: Buffer | null
}

function capturePreImage(path: string): FilePreImage {
  try {
    return { path, bytes: readFileSync(path) }
  } catch {
    return { path, bytes: null }
  }
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
