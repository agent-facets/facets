import type { RollbackOutcome } from '@agent-facets/engine'

/**
 * What a failed run left on disk, in one clause.
 *
 * The single source of truth for a fact the CLI otherwise asserts
 * independently in every place it reports a failure — the stderr `fix:`
 * line, the Ink failure block, and the partial-rollback note. Those copies
 * disagreed: the block claimed "Rolled back to pre-install state" for an
 * abort that happened before anything was written.
 *
 * The exhaustive switch is the point. A fourth `RollbackOutcome` arm becomes
 * a compile error here rather than a silently unrendered case.
 */
export function describeDiskState(rollback: RollbackOutcome): string {
  switch (rollback.kind) {
    case 'not-needed':
      return 'nothing was written; project state unchanged'
    case 'succeeded':
      return 'the project was restored to its previous state'
    case 'partial-failure':
      return (
        `partial state may remain on disk after ${rollback.failures} rollback ` +
        `failure${rollback.failures === 1 ? '' : 's'} ` +
        `(${rollback.entriesUndone} entr${rollback.entriesUndone === 1 ? 'y' : 'ies'} successfully undone)`
      )
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
