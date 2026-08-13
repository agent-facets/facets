import type { FailedBatch, FileRollbackIssue, FileRollbackOutcome } from './transaction.ts'

/**
 * Combining the accounts of two rollbacks into one honest report.
 *
 * A failed operation can unwind in two places: the batch that failed undoes
 * itself on the spot, and the journal of everything before it is unwound
 * afterwards. Neither knows about the other, and only the caller sees both —
 * so the folding rule lives here rather than in either of them.
 */

/** A rollback that had nothing to do. The identity of {@link mergeRollbackOutcomes}. */
export const NO_ROLLBACK: FileRollbackOutcome = Object.freeze({
  kind: 'complete',
  restored: Object.freeze([]),
  alreadyRestored: Object.freeze([]),
  removedDirectories: Object.freeze([]),
})

/** What a failed batch already put back before its caller was told anything. */
export function batchResidue(batch: FailedBatch): FileRollbackOutcome {
  return batch.stage === 'aborted' ? batch.rollback : NO_ROLLBACK
}

/**
 * Fold two rollback outcomes into one, `earlier` first.
 *
 * Not a concatenation, for two reasons.
 *
 * A path an earlier unwind could not put back is still holding this run's
 * bytes. The later one, comparing it against what it recorded, sees neither
 * endpoint and calls it a concurrent edit — which would blame a third party
 * for this run's own residue. So the earlier account of a path wins.
 *
 * And an unresolved path must not also be counted among the restored ones:
 * naming a file as unrecoverable while including it in "and N others were
 * restored" is two contradictory claims about one file.
 */
export function mergeRollbackOutcomes(earlier: FileRollbackOutcome, later: FileRollbackOutcome): FileRollbackOutcome {
  const issues = new Map<string, FileRollbackIssue>()
  for (const issue of issuesOf(earlier)) issues.set(issue.path, issue)
  for (const issue of issuesOf(later)) {
    if (!issues.has(issue.path)) issues.set(issue.path, issue)
  }

  const unresolved = new Set(issues.keys())
  const restored = dedupe([...earlier.restored, ...later.restored], unresolved)
  const alreadyRestored = dedupe(
    [...earlier.alreadyRestored, ...later.alreadyRestored],
    new Set([...unresolved, ...restored]),
  )
  const removedDirectories = dedupe([...earlier.removedDirectories, ...later.removedDirectories], new Set())

  const merged = [...issues.values()]
  const [first, ...rest] = merged
  if (first === undefined) return { kind: 'complete', restored, alreadyRestored, removedDirectories }
  return { kind: 'incomplete', restored, alreadyRestored, removedDirectories, issues: [first, ...rest] }
}

function issuesOf(outcome: FileRollbackOutcome): readonly FileRollbackIssue[] {
  return outcome.kind === 'incomplete' ? outcome.issues : []
}

function dedupe(paths: readonly string[], exclude: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const path of paths) {
    if (exclude.has(path) || seen.has(path)) continue
    seen.add(path)
    kept.push(path)
  }
  return kept
}
