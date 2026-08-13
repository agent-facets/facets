import type { FileTransaction } from '../../fs/index.ts'
import type { OnLog, RunInstallFailure } from '../types.ts'
import type { PreparedMcpAdapter } from './prepare.ts'

/**
 * Commit the MCP document changes each adapter planned.
 *
 * Runs after every asset write and immediately before the project-file
 * commit. That ordering is deliberate: a tool watching its own configuration
 * should see a server appear as late as possible in an operation that might
 * still fail, and the assets a server's tooling might reference are already on
 * disk by the time it does.
 *
 * Adapters supply no inverse operations, and none is needed. Each planned
 * mutation carries the document's exact prior state, so the transaction
 * refuses the write if something else edited the file in the meantime and can
 * restore the original bytes afterwards — without an adapter having to
 * reproduce comments and formatting it never saw.
 *
 * Two adapters whose plans touch one document are handled by the transaction's
 * coalescing rather than by anything here: the first original is retained and
 * the latest committed state replaces the previous one, so a rollback returns
 * the document to where it stood before this run.
 */

export interface ApplyMcpArgs {
  prepared: readonly PreparedMcpAdapter[]
  transaction: FileTransaction
  signal?: AbortSignal | undefined
  onLog: OnLog
}

export type ApplyMcpResult = { ok: true } | { ok: false; failure: RunInstallFailure }

export async function applyMcpServers(args: ApplyMcpArgs): Promise<ApplyMcpResult> {
  const { prepared, transaction, signal, onLog } = args

  for (const { adapter, capability, request, plan } of prepared) {
    // Checked per adapter, mirroring the per-facet checkpoint in the write
    // pass: an interrupt during a three-adapter apply must not write all
    // three before anyone notices.
    if (signal?.aborted) return { ok: false, failure: { code: 'ABORTED' } }

    if (plan.action.kind === 'unchanged') {
      onLog(() => `[verbose] ${adapter}: MCP configuration already matched; nothing written`)
      continue
    }

    // Re-planned immediately before its own commit. An earlier adapter may
    // have written a document this one also targets, which would make the
    // first plan's precondition stale — and the transaction would rightly
    // refuse it. Re-planning against the committed state is what lets two
    // adapters share a document without either one applying a stale plan.
    const replanned = await capability.plan(request)
    if (!replanned.ok) {
      return { ok: false, failure: { code: 'MCP_APPLY_FAILED', adapter, failure: replanned.failure } }
    }
    // The user approved a set of outcomes, not a set of bytes. If re-planning
    // reaches a different conclusion about what this run does to any server,
    // the approval no longer covers it and the operation stops rather than
    // applying something nobody agreed to.
    if (!sameOutcomes(plan.outcomes, replanned.plan.outcomes)) {
      return {
        ok: false,
        failure: { code: 'MCP_CONTRACT_VIOLATION', violation: { kind: 'outcomes-changed', adapter } },
      }
    }

    if (replanned.plan.action.kind === 'unchanged') {
      onLog(() => `[verbose] ${adapter}: MCP configuration already matched; nothing written`)
      continue
    }

    const applied = transaction.apply(replanned.plan.action)
    if (!applied.ok) {
      return {
        ok: false,
        failure: {
          code: 'FILESYSTEM_TRANSACTION_FAILED',
          subject: { kind: 'mcp', adapter },
          failure: applied.failure,
        },
      }
    }
    for (const path of applied.applied) {
      onLog(() => `[verbose] ${adapter}: wrote MCP configuration (${path})`)
    }
  }

  return { ok: true }
}

/** Whether two outcome lists describe the same work, entry for entry. */
function sameOutcomes(
  before: readonly PreparedMcpAdapter['plan']['outcomes'][number][],
  after: readonly PreparedMcpAdapter['plan']['outcomes'][number][],
): boolean {
  if (before.length !== after.length) return false
  return before.every((outcome, index) => {
    const other = after[index]
    return other !== undefined && JSON.stringify(outcome) === JSON.stringify(other)
  })
}
