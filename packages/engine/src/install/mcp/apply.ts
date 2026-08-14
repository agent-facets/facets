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
 * Two adapters reconciling one document are refused during preparation, so
 * nothing here has to reason about a document another adapter is also about
 * to write.
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

    // Re-planned immediately before its own commit, including when the first
    // plan changed nothing. "Nothing to do" is a conclusion about a document,
    // and the document can have been edited since — during the approval
    // prompt, or by the tool itself — so accepting the old answer would let a
    // run report a server as configured that no longer is.
    const replanned = await capability.plan(request)
    if (!replanned.ok) {
      return { ok: false, failure: { code: 'MCP_APPLY_FAILED', adapter, failure: replanned.failure } }
    }
    // The user approved a set of outcomes, not a set of bytes. A different
    // conclusion now means something outside this run changed the document:
    // the approval no longer covers what would be written, and the adapter is
    // reporting the state it finds rather than misbehaving.
    if (
      !sameOutcomes(plan.outcomes, replanned.plan.outcomes) ||
      !sameDocuments(plan.documentPaths, replanned.plan.documentPaths)
    ) {
      return {
        ok: false,
        failure: {
          code: 'MCP_NATIVE_STATE_DRIFT',
          adapter,
          documents: [...replanned.plan.documentPaths],
        },
      }
    }

    // Handed over even when it changes nothing: the transaction treats that
    // as the no-op it is, and one path through here is one fewer place for
    // "already matched" to mean something subtly different.
    const applied = transaction.apply(replanned.plan.action)
    if (!applied.ok) {
      return {
        ok: false,
        failure: {
          code: 'FILESYSTEM_TRANSACTION_FAILED',
          subject: { kind: 'mcp', adapter },
          batch: applied,
        },
      }
    }
    if (applied.applied.length === 0) {
      onLog(() => `[verbose] ${adapter}: MCP configuration already matched; nothing written`)
    }
    for (const path of applied.applied) {
      onLog(() => `[verbose] ${adapter}: wrote MCP configuration (${path})`)
    }
  }

  return { ok: true }
}

type McpOutcome = PreparedMcpAdapter['plan']['outcomes'][number]

/** Whether two outcome lists describe the same work, entry for entry. */
function sameOutcomes(before: readonly McpOutcome[], after: readonly McpOutcome[]): boolean {
  if (before.length !== after.length) return false
  return before.every((outcome, index) => {
    const other = after[index]
    return other !== undefined && sameOutcome(outcome, other)
  })
}

/**
 * Field by field rather than by serializing both sides: two adapters — or one
 * adapter across two calls — need not build these objects in the same key
 * order, and a comparison that depends on that would report drift nobody
 * caused.
 */
function sameOutcome(a: McpOutcome, b: McpOutcome): boolean {
  if (a.kind !== b.kind || a.name !== b.name) return false
  if (a.kind === 'obsolete-owned') return b.kind === 'obsolete-owned' && a.occupancy === b.occupancy
  return b.kind !== 'obsolete-owned' && a.ownership === b.ownership
}

/** Whether a re-plan read the same documents, in the same order. */
function sameDocuments(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.every((path, index) => path === after[index])
}
