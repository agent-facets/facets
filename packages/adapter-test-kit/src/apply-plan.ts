import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FileMutation, FileMutationAction, FileState } from '@agent-facets/adapter'

/**
 * Commit a planned action the way the engine would.
 *
 * Deliberately minimal: the transaction's own guarantees — preflight,
 * journaling, batch atomicity, rollback — are tested where the transaction
 * lives. Reimplementing them here would test the copy rather than the adapter.
 * What an adapter test needs is simply "and then the plan was applied", so that
 * formatting, byte-order marks, and comment preservation can be asserted on the
 * resulting document.
 */
export function commitPlannedAction(action: FileMutationAction): void {
  if (action.kind === 'unchanged') return
  commitMutations(action.mutations)
}

export function commitMutations(mutations: readonly FileMutation[]): void {
  for (const mutation of mutations) {
    if (mutation.kind === 'delete') {
      rmSync(mutation.path, { force: true })
      continue
    }
    mkdirSync(dirname(mutation.path), { recursive: true })
    writeFileSync(mutation.path, mutation.contents)
  }
}

/** The state a planned mutation must have been computed against. */
export function currentFileState(path: string): FileState {
  if (!existsSync(path)) return { kind: 'absent' }
  const stats = statSync(path)
  return { kind: 'regular-file', contents: new Uint8Array(readFileSync(path)), mode: stats.mode & 0o7777 }
}
