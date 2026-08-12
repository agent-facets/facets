import { capturePreimage, type FilePreimage, restorePreimage } from '../file-preimage.ts'
import type { InstallJournal } from '../journal.ts'
import type { OnLog, RunInstallFailure } from '../types.ts'
import { insideProject, type PreparedMcpAdapter } from './prepare.ts'

/**
 * Apply prepared MCP plans, with a byte-exact undo for every document
 * actually changed.
 *
 * Runs after every asset write and immediately before the tri-write. That
 * ordering is deliberate: a tool watching its own configuration should see a
 * server appear as late as possible in an operation that might still fail,
 * and the assets a server's tooling might reference are already on disk by
 * the time it does.
 *
 * Adapters supply no inverse operations. Rollback fidelity is the engine's:
 * it captures each disclosed document's exact prior bytes before the write
 * and journals a restore, so putting a JSONC file back does not depend on an
 * adapter reproducing comments it never saw.
 */

export interface ApplyMcpArgs {
  prepared: readonly PreparedMcpAdapter[]
  projectRoot: string
  journal: InstallJournal
  signal?: AbortSignal | undefined
  onLog: OnLog
}

export type ApplyMcpResult = { ok: true } | { ok: false; failure: RunInstallFailure }

export async function applyMcpServers(args: ApplyMcpArgs): Promise<ApplyMcpResult> {
  const { prepared, projectRoot, journal, signal, onLog } = args

  for (const { adapter, capability, preparation } of prepared) {
    // Checked per adapter, mirroring the per-facet checkpoint in the write
    // pass: an interrupt during a three-adapter apply must not write all
    // three before anyone notices.
    if (signal?.aborted) return { ok: false, failure: { code: 'ABORTED' } }

    // Capture every DISCLOSED document, not just the ones that will change:
    // which ones change is only known after `apply` returns, and a preimage
    // read afterwards would record the post-write bytes.
    //
    // Deliberately not deduplicated across adapters. If two adapters disclose
    // one path, the second capture holds the first adapter's written bytes,
    // and LIFO replay walks back through them to the original — which is the
    // correct final state, arrived at without the engine having to model
    // shared documents.
    const preimages = new Map<string, FilePreimage>()
    for (const path of preparation.documentPaths) {
      if (preimages.has(path)) continue
      const captured = capturePreimage(path)
      if (!captured.ok) {
        // Refuse to let the adapter write. A document this run cannot read is
        // one it cannot put back, and an unrestorable write is worse than a
        // failed operation.
        return { ok: false, failure: { code: 'MCP_DOCUMENT_UNREADABLE', adapter, path, cause: captured.cause } }
      }
      preimages.set(path, captured.preimage)
    }

    const applied = await capability.apply({ plan: preparation.plan })
    if (!applied.ok) {
      return { ok: false, failure: { code: 'MCP_APPLY_FAILED', adapter, failure: applied.failure } }
    }
    if (applied.status === 'unchanged') {
      onLog(() => `[verbose] ${adapter}: MCP configuration already matched; nothing written`)
      continue
    }

    for (const path of applied.changedPaths) {
      const preimage = preimages.get(path)
      if (preimage === undefined || !insideProject(projectRoot, path)) {
        // The adapter wrote somewhere it never disclosed, so no preimage
        // exists for it. Reported rather than journaled: the caller rolls
        // back everything that IS restorable, and the failure names the one
        // thing that is not.
        return {
          ok: false,
          failure: {
            code: 'MCP_CONTRACT_VIOLATION',
            violation: { kind: 'undisclosed-changed-path', adapter, path },
          },
        }
      }
      journal.record({
        label: `mcp ${adapter}:${path}`,
        undo: async () => {
          const restored = restorePreimage(preimage)
          if (!restored.ok) {
            // Must throw: the journal counts an undo as failed only when it
            // throws, so returning here would report a clean rollback while a
            // tool's configuration stayed changed.
            throw new Error(`failed to restore ${path}: ${restored.cause}`)
          }
        },
      })
      onLog(() => `[verbose] ${adapter}: wrote MCP configuration (${path})`)
    }
  }

  return { ok: true }
}
