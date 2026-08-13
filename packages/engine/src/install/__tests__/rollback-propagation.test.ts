import { describe, expect, test } from 'bun:test'
import { type FailedBatch, type FileRollbackOutcome, FileTransaction } from '../../fs/index.ts'
import { rollbackAndFail } from '../run-install-support.ts'
import type { RunInstallFailure } from '../types.ts'

/**
 * An aborted batch unwinds itself and merges nothing into the journal, so the
 * journal rollback that runs afterwards cannot see those paths at all. If the
 * batch's own account is dropped on the way out, a run that left a file
 * changed reports that nothing was written.
 */

const ABSENT = { kind: 'absent' } as const

const strandedUnwind: FileRollbackOutcome = {
  kind: 'incomplete',
  restored: [],
  alreadyRestored: [],
  removedDirectories: [],
  issues: [
    {
      kind: 'restore-failed',
      path: '/p/facets.json',
      original: ABSENT,
      committed: ABSENT,
      failure: { operation: 'commit', path: '/p/facets.json', message: 'EIO' },
    },
  ],
}

const aborted: FailedBatch = {
  stage: 'aborted',
  failure: { kind: 'conflict', path: '/p/facets.json', expected: ABSENT, observed: ABSENT },
  rollback: strandedUnwind,
}

const refused: FailedBatch = {
  stage: 'refused',
  failure: {
    kind: 'preflight',
    issues: [{ kind: 'drift', path: '/p/facets.json', expected: ABSENT, observed: ABSENT }],
  },
}

function transactionFailed(batch: FailedBatch): RunInstallFailure {
  return { code: 'FILESYSTEM_TRANSACTION_FAILED', subject: { kind: 'project-files' }, batch }
}

const silent = () => {}

describe('rollbackAndFail', () => {
  test('reports a batch that could not unwind, even when the journal is clean', () => {
    const result = rollbackAndFail(new FileTransaction(), transactionFailed(aborted), silent)

    if (result.ok) expect.unreachable()
    if (result.rollback.kind !== 'incomplete') expect.unreachable()
    expect(result.rollback.issues.map((issue) => issue.path)).toEqual(['/p/facets.json'])
  })

  test('a refused batch armed nothing, so it adds nothing to report', () => {
    const result = rollbackAndFail(new FileTransaction(), transactionFailed(refused), silent)

    if (result.ok) expect.unreachable()
    expect(result.rollback.kind).toBe('complete')
  })

  test('a failure with no batch of its own is unaffected', () => {
    const result = rollbackAndFail(new FileTransaction(), { code: 'ABORTED' }, silent)

    if (result.ok) expect.unreachable()
    expect(result.rollback.kind).toBe('complete')
  })

  test('logs every path it could not put back', () => {
    const lines: string[] = []
    rollbackAndFail(new FileTransaction(), transactionFailed(aborted), (line) => lines.push(line()))

    expect(lines.some((line) => line.includes('could not restore /p/facets.json'))).toBe(true)
  })
})
