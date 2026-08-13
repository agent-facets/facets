import { describe, expect, test } from 'bun:test'
import type { RollbackOutcome, RunInstallFailure } from '@agent-facets/engine'
import { writeInstallFailureDetail } from '../install-detail.ts'

/**
 * What a run that could not put everything back tells a user who has no
 * terminal to be asked in.
 *
 * The contract is narrow and load-bearing: name every path, never prompt,
 * never offer to overwrite. A file another process now owns is reported and
 * left exactly as that process left it, and the paths are what makes
 * recovering from there possible at all.
 */

const aborted: RunInstallFailure = { code: 'ABORTED' }

function captureStderr(run: () => void): string {
  const original = process.stderr.write.bind(process.stderr)
  let captured = ''
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    run()
  } finally {
    process.stderr.write = original
  }
  return captured
}

describe('writeInstallFailureDetail — rollback conflicts', () => {
  const contested: RollbackOutcome = {
    kind: 'incomplete',
    restored: ['/p/.tool/agents/kept.md'],
    alreadyRestored: [],
    removedDirectories: [],
    issues: [
      {
        kind: 'conflict',
        path: '/p/.tool/agents/contested.md',
        original: { kind: 'absent' },
        committed: { kind: 'absent' },
        observed: { kind: 'absent' },
      },
    ],
  }

  test('names the contested path on stderr without asking anything', () => {
    const stderr = captureStderr(() => writeInstallFailureDetail(aborted, contested))

    expect(stderr).toContain('/p/.tool/agents/contested.md')
    expect(stderr).toContain('changed by something else')
    // Not a question, not an offer: there is nobody to answer, and the file
    // belongs to whoever wrote it now.
    expect(stderr).not.toContain('?')
    expect(stderr.toLowerCase()).not.toContain('overwrite')
  })

  test('says how many other files were restored, so the report is complete', () => {
    const stderr = captureStderr(() => writeInstallFailureDetail(aborted, contested))
    expect(stderr).toContain('1 other file(s) were restored')
  })

  test('a restore that genuinely failed reads differently from a preserved edit', () => {
    const stuck: RollbackOutcome = {
      kind: 'incomplete',
      restored: [],
      alreadyRestored: [],
      removedDirectories: [],
      issues: [
        {
          kind: 'restore-failed',
          path: '/p/.tool/agents/stuck.md',
          original: { kind: 'absent' },
          committed: { kind: 'absent' },
          failure: { operation: 'commit', path: '/p/.tool/agents/stuck.md', message: 'EIO' },
        },
      ],
    }

    const stderr = captureStderr(() => writeInstallFailureDetail(aborted, stuck))

    expect(stderr).toContain('could not be returned to their previous state')
    expect(stderr).toContain('EIO')
  })

  test('a clean rollback writes no rollback detail at all', () => {
    const complete: RollbackOutcome = {
      kind: 'complete',
      restored: ['/p/.tool/agents/kept.md'],
      alreadyRestored: [],
      removedDirectories: [],
    }

    expect(captureStderr(() => writeInstallFailureDetail(aborted, complete))).toBe('')
  })
})
