import { describe, expect, test } from 'bun:test'
import { InstallJournal } from '../journal.ts'

/**
 * Direct unit tests for `InstallJournal`. The class is exercised
 * end-to-end by `runInstall` integration tests, but those go through
 * the entire install pipeline — too much surface area to pin down
 * journal-specific behavior. These tests target the LIFO ordering,
 * the partial-failure branch, the `entriesUndone` counter (added
 * in #9), and the post-rollback empty-state guarantees.
 */

describe('InstallJournal — record + size', () => {
  test('starts at size 0', () => {
    const journal = new InstallJournal()
    expect(journal.size()).toBe(0)
  })

  test('size increments per record', () => {
    const journal = new InstallJournal()
    journal.record({ label: 'a', undo: async () => {} })
    expect(journal.size()).toBe(1)
    journal.record({ label: 'b', undo: async () => {} })
    expect(journal.size()).toBe(2)
  })
})

describe('InstallJournal — rollback ordering (LIFO)', () => {
  test('replays inverse ops in reverse-record order', async () => {
    const calls: string[] = []
    const journal = new InstallJournal()
    journal.record({
      label: 'first',
      undo: async () => {
        calls.push('first')
      },
    })
    journal.record({
      label: 'second',
      undo: async () => {
        calls.push('second')
      },
    })
    journal.record({
      label: 'third',
      undo: async () => {
        calls.push('third')
      },
    })

    await journal.rollback()

    // LIFO: last recorded → first replayed.
    expect(calls).toEqual(['third', 'second', 'first'])
  })

  test('drains the journal — second rollback is a no-op', async () => {
    const journal = new InstallJournal()
    journal.record({ label: 'a', undo: async () => {} })
    expect(journal.size()).toBe(1)

    await journal.rollback()
    expect(journal.size()).toBe(0)

    // Second call: nothing to do, returns the empty-success shape.
    const second = await journal.rollback()
    expect(second).toEqual({ ok: true, failures: 0, entriesUndone: 0 })
  })
})

describe('InstallJournal — rollback result shape', () => {
  test('reports ok=true with entriesUndone count on full success', async () => {
    const journal = new InstallJournal()
    journal.record({ label: 'a', undo: async () => {} })
    journal.record({ label: 'b', undo: async () => {} })
    journal.record({ label: 'c', undo: async () => {} })

    const result = await journal.rollback()

    expect(result).toEqual({ ok: true, failures: 0, entriesUndone: 3 })
  })

  test('reports zero counts on an empty journal', async () => {
    const journal = new InstallJournal()
    const result = await journal.rollback()
    expect(result).toEqual({ ok: true, failures: 0, entriesUndone: 0 })
  })
})

describe('InstallJournal — partial failure', () => {
  test('continues replaying after an undo throws', async () => {
    const calls: string[] = []
    const journal = new InstallJournal()
    journal.record({
      label: 'first',
      undo: async () => {
        calls.push('first-undone')
      },
    })
    journal.record({
      label: 'second',
      undo: async () => {
        // Simulate an inverse op that fails (e.g. adapter delete on a
        // file that was already removed by an external process).
        throw new Error('simulated undo failure')
      },
    })
    journal.record({
      label: 'third',
      undo: async () => {
        calls.push('third-undone')
      },
    })

    const result = await journal.rollback()

    // We must continue past the failure — both `first` and `third`
    // had their inverses replayed despite `second` throwing.
    expect(calls).toEqual(['third-undone', 'first-undone'])
    expect(result.ok).toBe(false)
    expect(result.failures).toBe(1)
    expect(result.entriesUndone).toBe(2)
  })

  test('counts every failure when multiple undos throw', async () => {
    const journal = new InstallJournal()
    journal.record({
      label: 'a',
      undo: async () => {
        throw new Error('boom-a')
      },
    })
    journal.record({
      label: 'b',
      undo: async () => {
        throw new Error('boom-b')
      },
    })
    journal.record({
      label: 'c',
      undo: async () => {
        throw new Error('boom-c')
      },
    })

    const result = await journal.rollback()

    expect(result.ok).toBe(false)
    expect(result.failures).toBe(3)
    expect(result.entriesUndone).toBe(0)
  })
})

describe('InstallJournal — onLog observability', () => {
  test('emits one verbose line per successful undo', async () => {
    const lines: string[] = []
    const journal = new InstallJournal()
    journal.record({ label: 'install foo', undo: async () => {} })
    journal.record({ label: 'install bar', undo: async () => {} })

    await journal.rollback({ onLog: (build) => lines.push(build()) })

    // LIFO so `bar` first, `foo` second.
    expect(lines).toEqual(['[verbose] undo install bar', '[verbose] undo install foo'])
  })

  test('emits a FAILED log for each failed undo with the cause', async () => {
    const lines: string[] = []
    const journal = new InstallJournal()
    journal.record({
      label: 'install foo',
      undo: async () => {
        throw new Error('disk full')
      },
    })

    await journal.rollback({ onLog: (build) => lines.push(build()) })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('undo FAILED install foo')
    expect(lines[0]).toContain('disk full')
  })

  test('omits onLog gracefully when not provided', async () => {
    const journal = new InstallJournal()
    journal.record({ label: 'a', undo: async () => {} })
    // Must not throw with no onLog handler.
    const result = await journal.rollback()
    expect(result.ok).toBe(true)
  })
})
