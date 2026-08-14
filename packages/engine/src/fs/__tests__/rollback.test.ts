import { describe, expect, test } from 'bun:test'
import { batchResidue, mergeRollbackOutcomes, NO_ROLLBACK } from '../rollback.ts'
import type { FailedBatch, FileRollbackIssue, FileRollbackOutcome } from '../transaction.ts'

/**
 * A failed operation unwinds in two places that cannot see each other: the
 * batch that failed undoes itself on the spot, and the journal of everything
 * before it is drained afterwards. What the user is told is the fold of the
 * two, and the folding rule is where a contradiction between them would show
 * up as a report claiming a file was both lost and restored.
 */

const ABSENT = { kind: 'absent' } as const

function issue(path: string, kind: FileRollbackIssue['kind'] = 'conflict'): FileRollbackIssue {
  if (kind === 'restore-failed') {
    return {
      kind,
      path,
      original: ABSENT,
      committed: ABSENT,
      failure: { operation: 'delete', path, message: 'EACCES' },
    }
  }
  if (kind === 'inspect-failed') {
    return { kind, path, original: ABSENT, committed: ABSENT, failure: { reason: 'unreadable', path, message: 'EIO' } }
  }
  return { kind, path, original: ABSENT, committed: ABSENT, observed: ABSENT }
}

function complete(restored: string[] = [], alreadyRestored: string[] = [], dirs: string[] = []): FileRollbackOutcome {
  return { kind: 'complete', restored, alreadyRestored, removedDirectories: dirs }
}

function incomplete(issues: FileRollbackIssue[], restored: string[] = [], dirs: string[] = []): FileRollbackOutcome {
  const [first, ...rest] = issues
  if (first === undefined) expect.unreachable()
  return { kind: 'incomplete', restored, alreadyRestored: [], removedDirectories: dirs, issues: [first, ...rest] }
}

describe('batchResidue', () => {
  test('a refused batch armed nothing, so it unwound nothing', () => {
    const batch: FailedBatch = { stage: 'refused', failure: { kind: 'invalid-batch', failures: [] } as never }
    expect(batchResidue(batch)).toBe(NO_ROLLBACK)
  })

  test('an aborted batch carries its own account', () => {
    const rollback = incomplete([issue('/a')])
    const batch: FailedBatch = {
      stage: 'aborted',
      failure: { kind: 'conflict', path: '/a', expected: ABSENT, observed: ABSENT },
      rollback,
    }
    expect(batchResidue(batch)).toBe(rollback)
  })
})

describe('mergeRollbackOutcomes', () => {
  test('nothing on either side is the identity', () => {
    const outcome = complete(['/a'], ['/b'], ['/dir'])
    expect(mergeRollbackOutcomes(NO_ROLLBACK, outcome)).toEqual(outcome)
    expect(mergeRollbackOutcomes(outcome, NO_ROLLBACK)).toEqual(outcome)
  })

  test('two clean unwinds stay clean, and their paths are unioned', () => {
    const merged = mergeRollbackOutcomes(complete(['/a']), complete(['/b']))
    expect(merged.kind).toBe('complete')
    expect(merged.restored).toEqual(['/a', '/b'])
  })

  test('a path restored on both sides is reported once', () => {
    expect(mergeRollbackOutcomes(complete(['/a']), complete(['/a'])).restored).toEqual(['/a'])
  })

  // The regression this whole change exists for: an incomplete batch unwind
  // followed by a clean journal rollback is not a clean rollback.
  test('an issue on either side makes the whole thing incomplete', () => {
    expect(mergeRollbackOutcomes(incomplete([issue('/a')]), complete(['/b'])).kind).toBe('incomplete')
    expect(mergeRollbackOutcomes(complete(['/b']), incomplete([issue('/a')])).kind).toBe('incomplete')
  })

  // The later unwind compares the path against what IT recorded, sees neither
  // endpoint, and calls it a concurrent edit — blaming a third party for this
  // run's own residue.
  test('the earlier diagnosis of a path wins', () => {
    const merged = mergeRollbackOutcomes(
      incomplete([issue('/a', 'restore-failed')]),
      incomplete([issue('/a', 'conflict')]),
    )
    if (merged.kind !== 'incomplete') expect.unreachable()
    expect(merged.issues).toHaveLength(1)
    expect(merged.issues[0]?.kind).toBe('restore-failed')
  })

  test('an unresolved path is never also counted as restored', () => {
    const merged = mergeRollbackOutcomes(incomplete([issue('/a')]), complete(['/a', '/b']))
    expect(merged.restored).toEqual(['/b'])
  })

  test('a path restored earlier but unresolved later is not counted as restored', () => {
    const merged = mergeRollbackOutcomes(complete(['/a']), incomplete([issue('/a')]))
    expect(merged.restored).toEqual([])
  })

  test('already-restored never overlaps restored or an issue', () => {
    const merged = mergeRollbackOutcomes(complete([], ['/a', '/b', '/c']), incomplete([issue('/a')], ['/b']))
    expect(merged.alreadyRestored).toEqual(['/c'])
  })

  test('removed directories are unioned and deduplicated', () => {
    const merged = mergeRollbackOutcomes(complete([], [], ['/d']), complete([], [], ['/d', '/e']))
    expect(merged.removedDirectories).toEqual(['/d', '/e'])
  })
})
