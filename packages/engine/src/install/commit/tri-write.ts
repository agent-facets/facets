import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FacetsJson, Lockfile, LockfileFacet } from '@agent-facets/protocol'
import { writeFacetsJson } from '../../manifest/project-files.ts'
import { FACETS_LOCK_FILE, writeLockfile } from '../lockfile-io.ts'
import { type Receipt, type ReceiptFacetEntry, receiptPath, writeReceipt } from '../receipt.ts'
import type { RunInstallFailure } from '../types.ts'

/**
 * Derive the new receipt from the entries this run resolved. The
 * receipt records `{ version, assets[] }` per facet — a self-sufficient
 * deletion record for future drift removal.
 */
export function buildUpdatedReceipt(
  receipt: Receipt,
  newFacetEntries: Readonly<Record<string, LockfileFacet>>,
): Receipt {
  const facets: Record<string, ReceiptFacetEntry> = {}
  for (const [name, entry] of Object.entries(newFacetEntries)) {
    facets[name] = {
      version: entry.version,
      assets: entry.assets.map((a) => ({ scope: a.scope, type: a.type, name: a.name })),
    }
  }
  return { ...receipt, facets }
}

export type TriWriteResult = { ok: true } | { ok: false; failure: RunInstallFailure }

export interface TriWriteArgs {
  projectRoot: string
  facetsJson: FacetsJson
  desiredFacets: Readonly<Record<string, string>>
  newLockfile: Lockfile
  newReceipt: Receipt
  frozenLockfile: boolean
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
  const { projectRoot, frozenLockfile, newReceipt } = args

  if (frozenLockfile) {
    try {
      writeReceipt(projectRoot, newReceipt)
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

  try {
    const newManifest: FacetsJson = { ...args.facetsJson, facets: { ...args.desiredFacets } }
    writeFacetsJson(projectRoot, newManifest)
    writeLockfile(projectRoot, args.newLockfile)
    writeReceipt(projectRoot, newReceipt)
  } catch (error) {
    for (const image of preImages) {
      restorePreImage(image)
    }
    return {
      ok: false,
      failure: {
        code: 'LOCKFILE_WRITE_FAILED',
        path: join(projectRoot, FACETS_LOCK_FILE),
        cause: error instanceof Error ? error.message : String(error),
      },
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
