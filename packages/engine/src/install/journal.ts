/**
 * In-memory install journal (Adjustment B).
 *
 * ASCII — LIFO replay + inverse-op mapping:
 *
 *   Forward order:     undo stack:
 *   ┌──────────────┐   ┌──────────────┐
 *   │ install A    │◄──│ delete A     │
 *   │ install B    │◄──│ delete B     │
 *   │ delete C     │◄──│ install C    │  (with buffered original content)
 *   └──────────────┘   └──────────────┘
 *                           ▲
 *                           │ popped tail-first on rollback
 *
 * Rollback is best-effort: if any single undo fails we log via the provided
 * `onLog` callback and continue replaying — the caller is expected to emit
 * the §11.5 rollback-failure error when the replay ends. We intentionally
 * do NOT attempt rollback-of-rollback (a second SIGINT exits immediately
 * per Adjustment B).
 */

import type { OnLog } from './types.ts'

export interface JournalEntry {
  /** Human-readable label, surfaced through --verbose. */
  label: string
  /** Inverse operation executed during rollback. */
  undo: () => Promise<void>
}

export interface JournalRollbackOptions {
  onLog?: OnLog
}

export interface JournalRollbackResult {
  /** True if every inverse op succeeded. */
  ok: boolean
  /** Count of inverse ops that threw during replay. */
  failures: number
  /**
   * Count of inverse ops that successfully replayed. Together with
   * `failures`, callers can compose the user-facing rollback summary
   * ("rolled back N of M entries; K failed") without re-deriving
   * the totals.
   */
  entriesUndone: number
}

export class InstallJournal {
  private entries: JournalEntry[] = []

  record(entry: JournalEntry): void {
    this.entries.push(entry)
  }

  size(): number {
    return this.entries.length
  }

  async rollback(opts: JournalRollbackOptions = {}): Promise<JournalRollbackResult> {
    let failures = 0
    let entriesUndone = 0
    while (this.entries.length > 0) {
      const entry = this.entries.pop()
      if (!entry) break
      try {
        await entry.undo()
        entriesUndone++
        opts.onLog?.(`[verbose] undo ${entry.label}`)
      } catch (err) {
        failures++
        opts.onLog?.(`[verbose] undo FAILED ${entry.label}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { ok: failures === 0, failures, entriesUndone }
  }
}
