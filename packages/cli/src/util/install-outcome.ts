import type { FileRollbackIssue, RollbackOutcome } from '@agent-facets/engine'

/**
 * What a failed run left on disk, in one clause.
 *
 * The single source of truth for a fact the CLI otherwise asserts
 * independently in every place it reports a failure — the stderr `fix:`
 * line, the Ink failure block, and the partial-rollback note.
 *
 * The exhaustive switch is the point. A fourth `RollbackOutcome` arm becomes
 * a compile error here rather than a silently unrendered case.
 */
export function describeDiskState(rollback: RollbackOutcome): string {
  switch (rollback.kind) {
    case 'not-needed':
      return 'nothing was written; project state unchanged'
    case 'complete':
      return rollback.restored.length === 0
        ? 'nothing was written; project state unchanged'
        : 'the project was restored to its previous state'
    case 'incomplete':
      return `${rollback.issues.length} file${rollback.issues.length === 1 ? '' : 's'} could not be returned to ${
        rollback.issues.length === 1 ? 'its' : 'their'
      } previous state`
  }
}

/**
 * {@link describeDiskState} as a standalone sentence, for a rendered line
 * rather than a `fix:` fragment. Derived rather than restated so the two
 * surfaces cannot drift.
 */
export function diskStateSentence(rollback: RollbackOutcome): string {
  const clause = describeDiskState(rollback)
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`
}

/**
 * The per-path detail an incomplete rollback owes the user.
 *
 * A count is not actionable — recovering needs the paths, and needs to
 * distinguish "we deliberately left your edit alone" from "we tried to put
 * this back and could not". Those two call for opposite responses, so they are
 * never collapsed into one line.
 */
export function describeRollbackIssue(issue: FileRollbackIssue): string {
  switch (issue.kind) {
    case 'conflict':
      return `${issue.path} — changed by something else after this run wrote it; left as it is`
    case 'inspect-failed':
      return `${issue.path} — could not be read, so it was left as it is`
    case 'restore-failed':
      return `${issue.path} — could not be restored: ${issue.failure.message}`
  }
}

/**
 * Whether any issue is a preserved concurrent edit rather than a failure.
 *
 * Drives the guidance: a run that only declined to overwrite somebody else's
 * change did its job, and telling the user to go hunting for damage would be
 * wrong.
 */
export function hasPreservedConflicts(issues: readonly FileRollbackIssue[]): boolean {
  return issues.some((issue) => issue.kind === 'conflict')
}
