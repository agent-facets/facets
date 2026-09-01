import type { McpServerCapabilityFailure } from '@agent-facets/adapter'
import type { FileTransactionFailure, RollbackOutcome, RunInstallFailure } from '@agent-facets/engine'
import { describeDiskState, hasPreservedConflicts } from '../../util/install-outcome.ts'
import {
  describeUnsupportedManifestVersion,
  UNSUPPORTED_MANIFEST_VERSION_FIX,
} from '../../util/unsupported-manifest-version.ts'
import { ACCEPT_MCP_FLAG } from './flags.ts'

/**
 * The four front doors to the install pipeline.
 *
 * Named once because every remedy below ends by telling the user which
 * command to run again, and a literal union repeated at three signatures
 * is three places to forget the fourth door.
 */
export type InstallCommandName = 'add' | 'install' | 'remove' | 'update'

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
/**
 * The remedy for a lockfile-drift failure, which depends on the WHOLE reason
 * set rather than on any one entry.
 *
 * A stale override is the one drift the lockfile cannot fix, because it is not
 * recorded there: the choice lives in `facets.json` and names a contribution
 * the locked content no longer has. Every other reason is fixed by recording
 * the current state in the lockfile.
 *
 * So a mixed failure needs both, and the stale-only advice — "remove these
 * choices from facets.json" — would leave the rest of the drift in place and
 * the next run failing for the other half. Selecting it because *some* entry
 * was stale is the defect this replaces; the ordinary non-frozen run is the
 * one action that does both jobs, so it is what a mixed failure recommends.
 */
function lockfileDriftFix(facets: readonly { readonly reason: string }[], command: InstallCommandName): string {
  const stale = facets.filter((entry) => entry.reason === 'stale-override').length

  // An empty set cannot happen through the frozen gates, which only report
  // drift they found — but "no reasons" is not evidence of stale intent, so it
  // takes the ordinary advice rather than the narrower one.
  if (stale === 0 || facets.length === 0) {
    return "lockfile is out of date; run 'facet install' (without --frozen-lockfile) or 'facet add' to update it"
  }
  if (stale === facets.length) {
    return `remove the materialization choices listed above from facets.json, or re-run 'facet ${command}' without --frozen-lockfile to drop them automatically`
  }
  return `re-run 'facet ${command}' without --frozen-lockfile: that records the lockfile drift listed above and drops the stale materialization choices in the same run`
}

/**
 * The remedy for an adapter's own MCP failure, which depends on what it hit.
 *
 * "Repair the configuration document" was the shared answer while every one of
 * these carried a document path, and it is wrong for two of the three: a
 * document another process edited mid-run is not damaged, and an interpolated
 * literal is a problem with the declaration in `facets.json` — there is no
 * document to send the user to, and the one previously named was a guess.
 */
function mcpCapabilityFix(
  failure: McpServerCapabilityFailure,
  rollback: RollbackOutcome,
  command: InstallCommandName,
): string {
  const state = describeDiskState(rollback)
  if (failure.code !== 'conflict') {
    return `${state}; repair ${failure.path}, then re-run 'facet ${command}'`
  }
  switch (failure.reason) {
    case 'interpolation':
      return `edit or omit "${failure.serverName}" in facets.json so it declares no value that tool would expand, then re-run 'facet ${command}'`
    case 'native-state':
      return `${state}; repair ${failure.path} so the desired servers can be written, then re-run 'facet ${command}'`
  }
}

export function installFailureFix(
  failure: RunInstallFailure,
  rollback: RollbackOutcome,
  command: InstallCommandName,
): string {
  // An incomplete rollback outranks everything: whatever caused the failure
  // matters less than the fact that some file is not back where it started.
  // A preserved concurrent edit is called out separately — the run protected
  // somebody's change, and telling them to hunt for damage would be wrong.
  if (rollback.kind === 'incomplete') {
    return hasPreservedConflicts(rollback.issues)
      ? `review the files listed above — each was changed by something else and was left alone — then re-run 'facet ${command}'`
      : `${describeDiskState(rollback)}; inspect the files listed above before re-running 'facet ${command}'`
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
      return lockfileDriftFix(failure.facets, command)
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
      return `review the servers listed above, then re-run 'facet ${command} --${ACCEPT_MCP_FLAG}' to approve them, or omit them in facets.json`
    case 'MCP_CONSENT_DECLINED':
      return `${describeDiskState(rollback)}. Re-run 'facet ${command}' to review the servers again, or omit them in facets.json`
    case 'MCP_PREPARE_FAILED':
    case 'MCP_APPLY_FAILED':
      return mcpCapabilityFix(failure.failure, rollback, command)
    case 'FILESYSTEM_TRANSACTION_FAILED':
      return `${describeDiskState(rollback)}; ${transactionFix(failure.batch.failure)}, then re-run 'facet ${command}'`
    case 'MCP_CONTRACT_VIOLATION':
      // Nothing the user can edit; sending them to their own files would be
      // a wild goose chase.
      return 'report this to the adapter’s author; no project file needs changing'
    case 'MCP_DOCUMENT_OVERLAP':
      // Which tool should own the file is a choice only the user can make.
      return `deselect one of the adapters listed above, then re-run 'facet ${command}'`
    case 'MCP_NATIVE_STATE_DRIFT':
      return `${describeDiskState(rollback)}. Review the file listed above, then re-run 'facet ${command}'`
    case 'UPDATE_PLAN_STALE':
      // Nothing is broken and nothing needs repairing: the project moved
      // between the plan being shown and being applied, so the only
      // sensible action is to look at a plan built from what is there
      // now. Sending this to the default arm's "fix the underlying
      // issue" would invent a problem to hunt for.
      return `${describeDiskState(rollback)}. Re-run 'facet ${command}' to plan against the current project state`
    default:
      // Most codes that land here failed BEFORE the journal opened —
      // `LOCK_HELD`, `FACETS_JSON_NOT_FOUND`, `FROZEN_WITH_DELTA`,
      // `ADAPTER_INCOMPATIBLE`, every registry and parse error. A flat
      // "rollback complete" told all of them a rollback had run while the
      // Ink block on stdout said nothing was written, from the same result.
      return `${describeDiskState(rollback)}; fix the underlying issue and re-run 'facet ${command}'`
  }
}

/**
 * What to do about a refused or failed file change.
 *
 * A drifted file and an unwritable one call for opposite responses — re-run
 * versus repair — so the remedy is chosen from the failure rather than from a
 * single sentence that would have to fit both.
 */
function transactionFix(failure: FileTransactionFailure): string {
  switch (failure.kind) {
    case 'preflight':
    case 'conflict':
      return 'something else changed a file mid-run'
    case 'invalid-batch':
      return "report this to the adapter's author; no project file needs changing"
    case 'inspect-failed':
    case 'verify-mismatch':
    case 'operation':
      return 'repair the file named above'
  }
}
