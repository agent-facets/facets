import { type FileMutation, inspectFileState } from '@agent-facets/common'
import {
  describeTransactionFailure,
  type FileRollbackOutcome,
  FileTransaction,
  transactionFailurePath,
} from './fs/index.ts'

/**
 * The authoring-side multi-file transaction.
 *
 * Both scaffold (`facet create`) and edit (`facet edit`) apply a batch of file
 * writes and deletions that must land as a unit: `facet.json`, `README.md`,
 * starter asset files, companion files. A partial application — the manifest
 * written but a file write failing — leaves the project declaring an asset it
 * has no file for, or vice versa.
 *
 * This is a thin front for the engine's file transaction, not a second
 * implementation of one. The difference is only in what the caller knows: an
 * install *plans* against states it read, while an authoring command simply
 * says "make these files look like this". So this reads the current state of
 * each target itself and hands the transaction the same exact transitions
 * every other caller supplies — which is what gives `facet create` and
 * `facet edit` the same guarantees an install has: no writes through symlinks,
 * no partial batches, and byte-exact restoration on failure.
 */

/** A single planned mutation against an exact absolute path. */
export type FsMutation = { kind: 'write'; path: string; bytes: Uint8Array } | { kind: 'delete'; path: string }

/** Result of applying a transaction. */
export type FsTransactionResult =
  | { ok: true }
  | {
      ok: false
      /** The exact path whose mutation failed, when the failure names one. */
      failedPath: string
      /** Human-readable reason. */
      reason: string
      /** What returning the tree to its prior state achieved. */
      rollback: FileRollbackOutcome
    }

/**
 * Apply `mutations` as a unit inside `boundary`.
 *
 * `boundary` is the directory the operation is confined to — the project or
 * facet root. Every path must be strictly below it, and directories created
 * beneath it are removed again if the batch has to be unwound.
 */
export function applyFsTransaction(mutations: readonly FsMutation[], boundary: string): FsTransactionResult {
  const planned: FileMutation[] = []
  for (const mutation of mutations) {
    const inspected = inspectFileState(mutation.path)
    if (!inspected.ok) {
      return {
        ok: false,
        failedPath: mutation.path,
        reason: `${mutation.path} could not be inspected before writing`,
        rollback: { kind: 'complete', restored: [], alreadyRestored: [], removedDirectories: [] },
      }
    }
    if (mutation.kind === 'delete') {
      // A missing target is not an error — the desired end state is "gone".
      if (inspected.state.kind !== 'regular-file') continue
      planned.push({ kind: 'delete', path: mutation.path, boundary, expected: inspected.state })
      continue
    }
    planned.push({ kind: 'write', path: mutation.path, boundary, expected: inspected.state, contents: mutation.bytes })
  }

  const [first, ...rest] = planned
  if (first === undefined) return { ok: true }

  const transaction = new FileTransaction()
  const applied = transaction.apply({ kind: 'mutate', mutations: [first, ...rest] })
  if (applied.ok) return { ok: true }

  // A refused batch armed nothing, so there is nothing to unwind; an aborted
  // one already restored its own savepoint. Either way the tree is as it was.
  const rollback: FileRollbackOutcome =
    applied.stage === 'aborted'
      ? applied.rollback
      : { kind: 'complete', restored: [], alreadyRestored: [], removedDirectories: [] }
  return {
    ok: false,
    failedPath: transactionFailurePath(applied.failure) ?? boundary,
    reason: describeTransactionFailure(applied.failure),
    rollback,
  }
}
