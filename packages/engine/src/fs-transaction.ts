import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A shared, engine-owned multi-file transaction.
 *
 * Both scaffold (`facet create`) and edit (`facet edit`) apply a batch of
 * file writes and deletions that must land as a unit: `facet.json`,
 * `README.md`, starter asset files, companion files. A partial application
 * — the manifest written but a file write failing — leaves the project in a
 * state that declares an asset it has no file for, or vice versa.
 *
 * This module captures a preimage of every affected path before mutating
 * anything, applies each mutation atomically (tmp + rename for writes), and
 * on any handled failure restores every preimage. Expected filesystem
 * failures are returned as discriminated data, never thrown, so callers that
 * can recover (the edit apply path) discriminate on the result.
 *
 * Rollback is best-effort in the same sense as the install journal: if a
 * restore step itself fails, `rollback.ok` is `false` and the failing paths
 * are reported, but the transaction still returns rather than throwing.
 */

/** A single planned mutation against an exact absolute path. */
export type FsMutation = { kind: 'write'; path: string; bytes: Uint8Array } | { kind: 'delete'; path: string }

/** Preimage of one affected path, captured before any mutation runs. */
type Preimage = { path: string; existed: false } | { path: string; existed: true; bytes: Uint8Array }

/** Outcome of a best-effort rollback after a failed apply. */
export type FsRollback = { ok: true } | { ok: false; failedPaths: string[] }

/** Result of applying a transaction. */
export type FsTransactionResult =
  | { ok: true }
  | {
      ok: false
      /** The exact path whose mutation failed. */
      failedPath: string
      /** Human-readable reason (the caught error's message). */
      reason: string
      /** Whether every prior mutation was successfully reverted. */
      rollback: FsRollback
    }

function capturePreimage(path: string): Preimage {
  if (!existsSync(path)) return { path, existed: false }
  return { path, existed: true, bytes: readFileSync(path) }
}

function applyMutation(mutation: FsMutation): void {
  if (mutation.kind === 'write') {
    mkdirSync(dirname(mutation.path), { recursive: true })
    // tmp + rename so a reader never observes a half-written file.
    const tmp = `${mutation.path}.tmp`
    writeFileSync(tmp, mutation.bytes)
    renameSync(tmp, mutation.path)
    return
  }
  // delete: a missing target is not an error — the desired end state is "gone".
  rmSync(mutation.path, { force: true })
}

function restorePreimage(preimage: Preimage): void {
  if (!preimage.existed) {
    // Path did not exist before the transaction; ensure it does not exist now.
    // `force` swallows ENOENT. If the target still cannot exist (e.g. a parent
    // is not a directory), it is already effectively absent — best-effort
    // absence restoration never fails the rollback.
    try {
      rmSync(preimage.path, { force: true })
    } catch {
      // Already absent for all practical purposes.
    }
    return
  }
  mkdirSync(dirname(preimage.path), { recursive: true })
  const tmp = `${preimage.path}.tmp`
  writeFileSync(tmp, preimage.bytes)
  renameSync(tmp, preimage.path)
}

/**
 * Apply `mutations` as a unit. On success every mutation is committed; on the
 * first failure, all captured preimages are restored (LIFO) and the result
 * carries the failed path plus rollback status.
 */
export function applyFsTransaction(mutations: readonly FsMutation[]): FsTransactionResult {
  // Capture preimages for every distinct affected path before touching disk.
  const seen = new Set<string>()
  const preimages: Preimage[] = []
  for (const mutation of mutations) {
    if (seen.has(mutation.path)) continue
    seen.add(mutation.path)
    preimages.push(capturePreimage(mutation.path))
  }

  const applied: FsMutation[] = []
  for (const mutation of mutations) {
    try {
      applyMutation(mutation)
      applied.push(mutation)
    } catch (err) {
      const rollback = rollbackApplied(preimages)
      return {
        ok: false,
        failedPath: mutation.path,
        reason: err instanceof Error ? err.message : String(err),
        rollback,
      }
    }
  }

  return { ok: true }
}

function rollbackApplied(preimages: readonly Preimage[]): FsRollback {
  const failedPaths: string[] = []
  // Restore in reverse capture order so nested-directory creation unwinds cleanly.
  for (let i = preimages.length - 1; i >= 0; i--) {
    const preimage = preimages[i]
    if (!preimage) continue
    try {
      restorePreimage(preimage)
    } catch {
      failedPaths.push(preimage.path)
    }
  }
  return failedPaths.length === 0 ? { ok: true } : { ok: false, failedPaths }
}
