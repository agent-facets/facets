import { describe, expect, test } from 'bun:test'
import type { RollbackOutcome, RunInstallFailure } from '@agent-facets/engine'
import { formatInstallFailureDetail, writeInstallFailureDetail } from '../install-detail.ts'

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

describe('formatInstallFailureDetail — server inventory reconciliation', () => {
  const notNeeded: RollbackOutcome = { kind: 'not-needed', reason: 'post-lock-no-mutation' }

  test('the stderr and JSON detail names the facet, the server, and both fingerprints', () => {
    const detail = formatInstallFailureDetail(
      {
        code: 'RECONCILE_SERVER_FINGERPRINT',
        facet: 'alpha',
        authoredName: 'filesystem',
        expected: `sha256:${'1'.repeat(64)}`,
        actual: `sha256:${'2'.repeat(64)}`,
      },
      notNeeded,
    )
    expect(detail).toContain('"filesystem"')
    expect(detail).toContain('"alpha"')
    expect(detail).toContain(`sha256:${'1'.repeat(64)}`)
    expect(detail).toContain(`sha256:${'2'.repeat(64)}`)
    expect(detail).toContain('Re-running will not repair it')
    expect(detail).toContain('were NOT changed')
  })

  test('a name-set mismatch lists both directions', () => {
    const detail = formatInstallFailureDetail(
      { code: 'RECONCILE_SERVER_IDENTITY', facet: 'alpha', missing: ['gone'], unexpected: ['extra'] },
      notNeeded,
    )
    expect(detail).toContain('locked but not declared: "gone"')
    expect(detail).toContain('declared but not locked: "extra"')
  })

  test('a hostile name is escaped on stderr too', () => {
    const detail = formatInstallFailureDetail(
      { code: 'RECONCILE_SERVER_IDENTITY', facet: 'alpha', missing: ['gone\u001b[2K\nforged'], unexpected: [] },
      notNeeded,
    )
    expect(detail).not.toContain('\u001b[2K')
    expect(detail).not.toContain('\nforged')
  })
})

describe('formatInstallFailureDetail — frozen checks over locked metadata', () => {
  const notNeeded: RollbackOutcome = { kind: 'not-needed', reason: 'post-lock-no-mutation' }
  const FP_A = `sha256:${'a'.repeat(64)}` as const
  const FP_B = `sha256:${'b'.repeat(64)}` as const

  const collision: RunInstallFailure = {
    code: 'LOCKED_MATERIALIZATION_COLLISION',
    groups: [
      {
        kind: 'mcp-server',
        group: {
          effectiveName: 'filesystem',
          members: [
            {
              facet: 'alpha',
              authoredName: 'filesystem',
              effectiveName: 'filesystem',
              fingerprint: FP_A,
              disposition: { kind: 'authored' },
            },
            {
              facet: 'beta',
              authoredName: 'filesystem',
              effectiveName: 'filesystem',
              fingerprint: FP_B,
              disposition: { kind: 'authored' },
            },
          ],
        },
      },
    ],
    staleOverrides: [
      { facet: 'alpha', contribution: { kind: 'mcp-server' }, authoredName: 'gone', disposition: { kind: 'omitted' } },
    ],
  }

  test('lists every claimant with its full locked fingerprint and the stale intent', () => {
    const detail = formatInstallFailureDetail(collision, notNeeded)

    expect(detail).toContain('before fetching anything')
    expect(detail).toContain('MCP servers — "filesystem" is claimed by:')
    expect(detail).toContain(`locked fingerprint ${FP_A}`)
    expect(detail).toContain(`locked fingerprint ${FP_B}`)
    expect(detail).toContain('at facets["beta"].materialization.servers["filesystem"]')
    expect(detail).toContain('server "gone"')
    expect(detail).toContain('were NOT changed')
  })

  test('offers no snippet to paste, because frozen mode would refuse it', () => {
    const detail = formatInstallFailureDetail(collision, notNeeded)
    expect(detail).not.toContain('"kind": "aliased"')
    expect(detail).toContain('make them in a normal install')
  })

  test('a removal migration note precedes the actual failure detail', () => {
    const detail = formatInstallFailureDetail(collision, notNeeded, {
      reason: 'remaining-server-inventory-unavailable',
      lockfileVersion: 0.2,
      requiredVersion: 0.4,
    })

    expect(detail.startsWith('facets.lock v0.2 records no MCP server inventory')).toBe(true)
    expect(detail).toContain(`locked fingerprint ${FP_A}`)
  })
})
