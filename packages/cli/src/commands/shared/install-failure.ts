import type { RollbackOutcome, RunInstallFailure } from '@agent-facets/engine'

/**
 * The `fix:` line for a failed install-pipeline run, shared by `add`,
 * `install`, and `remove`.
 *
 * These three commands are the same pipeline behind different front
 * doors, so their guidance drifted apart for no reason: three copies of
 * the rollback branch with three different phrasings of the same fact.
 * The only genuine variation is which command to re-run.
 */
export function installFailureFix(
  failure: RunInstallFailure,
  rollback: RollbackOutcome,
  command: 'add' | 'install' | 'remove',
): string {
  // Partial rollback outranks everything: whatever caused the failure
  // matters less than the fact that undoing it did not fully succeed.
  if (rollback.kind === 'partial-failure') {
    return `partial state may remain on disk after ${rollback.failures} rollback failure(s); inspect the project tree before re-running 'facet ${command}'`
  }

  switch (failure.code) {
    case 'MATERIALIZATION_COLLISION':
    case 'MATERIALIZATION_RESOLUTION_INVALID':
      return `record an alias or omission for each asset listed above in facets.json, then re-run 'facet ${command}'`
    case 'MATERIALIZATION_ALIAS_INVALID':
      return 'correct the invalid alias in facets.json, then re-run'
    case 'MATERIALIZATION_CANCELLED':
      return `cancelled; nothing was written. Re-run 'facet ${command}' to make the choices again`
    case 'ABORTED':
      return 'nothing was written; project state unchanged'
    case 'LOCKFILE_DRIFT':
      return "lockfile is out of date; run 'facet install' (without --frozen-lockfile) or 'facet add' to update it"
    default:
      return `rollback complete; fix the underlying issue and re-run 'facet ${command}'`
  }
}
