import type { InstallJournal } from './journal.ts'
import type { FacetOutcome, InstallSummary, RunInstallFailure, RunInstallResult } from './types.ts'

/** Aggregate per-facet outcomes into the post-install summary counts. */
export function summarize(
  perFacet: ReadonlyArray<FacetOutcome>,
  totalAssets: number,
  removedAssets: number,
): InstallSummary {
  const count = (kind: FacetOutcome['kind']) => perFacet.filter((o) => o.kind === kind).length
  return {
    installed: count('installed'),
    updated: count('updated'),
    repaired: count('repaired'),
    unchanged: count('unchanged'),
    removed: count('removed'),
    totalAssets,
    removedAssets,
  }
}

/**
 * Roll back the journal and return the failure. Called whenever a
 * mutation has been recorded and we need to undo it.
 */
export async function rollbackAndFail(
  journal: InstallJournal,
  failure: RunInstallFailure,
  onLog: (line: string) => void,
): Promise<RunInstallResult> {
  const rollback = await journal.rollback({ onLog })
  return {
    ok: false,
    failure,
    rollback: rollback.ok
      ? { kind: 'succeeded', entriesUndone: rollback.entriesUndone }
      : { kind: 'partial-failure', entriesUndone: rollback.entriesUndone, failures: rollback.failures },
  }
}
