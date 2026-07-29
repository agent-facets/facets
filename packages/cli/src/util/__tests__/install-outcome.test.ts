import { describe, expect, test } from 'bun:test'
import type { RollbackOutcome } from '@agent-facets/engine'
import { describeDiskState, diskStateSentence } from '../install-outcome.ts'

/**
 * "What did the failed run leave on disk" had four independent answers: the
 * stderr `fix:` line, the Ink abort block, the Ink lockfile-write block, and
 * a partial-rollback banner rendered beside all of them. They disagreed —
 * the abort block claimed a rollback that never ran.
 */

const ALL: RollbackOutcome[] = [
  { kind: 'not-needed', reason: 'failed before any disk mutation' },
  { kind: 'succeeded', entriesUndone: 3 },
  { kind: 'partial-failure', entriesUndone: 2, failures: 1 },
]

describe('describeDiskState', () => {
  test('a run that never mutated says nothing was written', () => {
    expect(describeDiskState(ALL[0] as RollbackOutcome)).toContain('nothing was written')
  })

  test('a completed rollback says the project was restored', () => {
    const described = describeDiskState(ALL[1] as RollbackOutcome)
    expect(described).toContain('restored')
    expect(described).not.toContain('nothing was written')
  })

  test('an incomplete rollback says state may remain, with the counts', () => {
    const described = describeDiskState({ kind: 'partial-failure', entriesUndone: 2, failures: 1 })
    expect(described).toContain('partial state may remain')
    expect(described).toContain('1 rollback failure')
    expect(described).toContain('2 entries')
  })

  test('counts are singularized', () => {
    const described = describeDiskState({ kind: 'partial-failure', entriesUndone: 1, failures: 2 })
    expect(described).toContain('2 rollback failures')
    expect(described).toContain('1 entry')
  })

  // Every arm must produce something a user can act on. An arm added to
  // `RollbackOutcome` without a case here is a compile error, but an arm that
  // compiles to an empty string would not be.
  test.each(ALL)('$kind produces a non-empty clause and sentence', (rollback) => {
    expect(describeDiskState(rollback).length).toBeGreaterThan(0)
    const sentence = diskStateSentence(rollback)
    expect(sentence.endsWith('.')).toBe(true)
    expect(sentence.charAt(0)).toBe(sentence.charAt(0).toUpperCase())
  })
})

describe('diskStateSentence', () => {
  // Derived, not restated — this is what stops the rendered line and the
  // `fix:` fragment from drifting the way they had.
  test.each(ALL)('$kind is the clause, sentence-cased and terminated', (rollback) => {
    const clause = describeDiskState(rollback)
    expect(diskStateSentence(rollback).toLowerCase()).toBe(`${clause.toLowerCase()}.`)
  })
})
