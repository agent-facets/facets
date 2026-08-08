import type { RollbackOutcome, RunInstallFailure } from '@agent-facets/engine'
import { describeDiskState } from '../../util/install-outcome.ts'
import {
  describeUnsupportedManifestVersion,
  UNSUPPORTED_MANIFEST_VERSION_FIX,
} from '../../util/unsupported-manifest-version.ts'

/**
 * The `detail:` line for a failed install-pipeline run.
 *
 * The failure code is the part scripts branch on, so it stays first and
 * stays machine-shaped. An unsupported `manifestVersion` adds the observed
 * and supported versions after it: that failure is the one whose whole
 * report is those two numbers, and the pipeline's front doors were dropping
 * them on the floor while the prepare phases printed them.
 */
export function installFailureDetail(failure: RunInstallFailure): string {
  if (failure.code === 'FACETS_JSON_UNSUPPORTED_VERSION') {
    return `code=${failure.code}; ${failure.path}: ${describeUnsupportedManifestVersion(failure)}`
  }
  return `code=${failure.code}`
}

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
    return `${describeDiskState(rollback)}; inspect the project tree before re-running 'facet ${command}'`
  }

  switch (failure.code) {
    case 'MATERIALIZATION_COLLISION':
    case 'MATERIALIZATION_RESOLUTION_INVALID':
      return `record an alias or omission for each asset listed above in facets.json, then re-run 'facet ${command}'`
    case 'MATERIALIZATION_ALIAS_INVALID':
      // The helper already knows which command to name; this was the one
      // actionable branch that made the user work it out.
      return `correct the invalid alias in facets.json, then re-run 'facet ${command}'`
    case 'MATERIALIZATION_CANCELLED':
      return `${describeDiskState(rollback)}. Re-run 'facet ${command}' to make the choices again`
    case 'ABORTED':
      // An abort can land before any mutation OR after writes that were then
      // rolled back. Claiming "nothing was written" in the second case sends
      // the user looking for a no-op when a rollback actually ran — and the
      // two are told apart by the rollback outcome, not by the failure code.
      // (`partial-failure` already returned above.)
      return `${describeDiskState(rollback)}. Re-run 'facet ${command}' when ready`
    case 'FACETS_JSON_UNSUPPORTED_VERSION':
      // Not a document to repair: the file is fine and this CLI is behind it.
      // The default arm's "fix the underlying issue" sends users editing a
      // manifest that is not wrong.
      return UNSUPPORTED_MANIFEST_VERSION_FIX
    case 'LOCKFILE_DRIFT':
      return "lockfile is out of date; run 'facet install' (without --frozen-lockfile) or 'facet add' to update it"
    case 'MCP_ADAPTERS_UNSUPPORTED':
      // Two remedies, and which one applies is per adapter — the detail block
      // above names each. This line says only that both exist, so a user who
      // reads it alone does not conclude that upgrading is always the answer.
      return `upgrade the adapters listed above, or omit their server declarations in facets.json, then re-run 'facet ${command}'`
    case 'ASSET_TAKEOVER_CANCELLED':
      // The disk state is the point: this cancellation happened after writes,
      // so "nothing happened" would be wrong and "re-run" alone would be
      // unhelpful without saying what state the tree is in.
      return `${describeDiskState(rollback)}. Re-run 'facet ${command}' and continue, or move the existing file aside first`
    case 'MCP_CONSENT_REQUIRED':
      return `review the servers listed above, then re-run 'facet ${command} --accept-mcp' to approve them, or omit them in facets.json`
    case 'MCP_CONSENT_DECLINED':
      return `${describeDiskState(rollback)}. Re-run 'facet ${command}' to review the servers again, or omit them in facets.json`
    case 'MCP_PREPARE_FAILED':
    case 'MCP_APPLY_FAILED':
    case 'MCP_DOCUMENT_UNREADABLE':
      return `${describeDiskState(rollback)}; repair the configuration document named above, then re-run 'facet ${command}'`
    case 'MCP_CONTRACT_VIOLATION':
      // Nothing the user can edit; sending them to their own files would be
      // a wild goose chase.
      return 'report this to the adapter’s author; no project file needs changing'
    default:
      // Most codes that land here failed BEFORE the journal opened —
      // `LOCK_HELD`, `FACETS_JSON_NOT_FOUND`, `FROZEN_WITH_DELTA`,
      // `ADAPTER_INCOMPATIBLE`, every registry and parse error. A flat
      // "rollback complete" told all of them a rollback had run while the
      // Ink block on stdout said nothing was written, from the same result.
      return `${describeDiskState(rollback)}; fix the underlying issue and re-run 'facet ${command}'`
  }
}
