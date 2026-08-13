import type { FileTransaction } from '../fs/index.ts'
import type { McpInstallOutcomes } from './mcp/outcomes.ts'
import type { FacetOutcome, InstallSummary, OnLog, RunInstallFailure, RunInstallResult } from './types.ts'

/** Aggregate per-facet outcomes and MCP work into the post-install summary. */
export function summarize(
  perFacet: ReadonlyArray<FacetOutcome>,
  totalAssets: number,
  removedAssets: number,
  mcp: McpInstallOutcomes,
): InstallSummary {
  const count = (kind: FacetOutcome['kind']) => perFacet.filter((o) => o.kind === kind).length
  return {
    facets: {
      installed: count('installed'),
      updated: count('updated'),
      repaired: count('repaired'),
      unchanged: count('unchanged'),
      // Both kinds dropped a declaration, which is what this count means. How
      // many ASSETS left disk is `textAssets.removed`, and for an untracked
      // removal that is zero — the two disagreeing is the signal, not a bug.
      removed: count('removed') + count('removed-untracked'),
    },
    textAssets: { written: totalAssets, removed: removedAssets },
    mcp: summarizeMcp(mcp),
  }
}

function summarizeMcp(mcp: McpInstallOutcomes): InstallSummary['mcp'] {
  const configurations = { added: 0, updated: 0, repaired: 0, unchanged: 0, removed: 0 }
  for (const outcome of mcp.configurations) {
    if (outcome.kind === 'active') {
      configurations[outcome.status]++
      continue
    }
    // An entry someone had already deleted by hand leaves nothing for this
    // run to do, so counting it as a removal would credit the operation with
    // work it did not perform. The claim still goes; the native file does not
    // change, which is what `unchanged` says.
    if (outcome.status === 'removed') configurations.removed++
    else configurations.unchanged++
  }

  const declarations = { aliased: 0, omitted: 0 }
  for (const disposition of mcp.dispositions) {
    if (disposition.kind === 'aliased') declarations.aliased++
    else if (disposition.kind === 'omitted') declarations.omitted++
  }

  return {
    configurations,
    declarations,
    // Only an accepted request can have adopted anything: a declined one
    // fails the operation before the journal opens.
    takeovers: { accepted: mcp.consent.kind === 'accepted' ? mcp.consent.request.takeovers.length : 0 },
  }
}

/**
 * Return every file this run changed to the state it was in, then report the
 * failure alongside what that achieved.
 *
 * Called whenever a mutation may have landed. The rollback never throws and
 * never stops early: a file another process took ownership of is left alone
 * and reported, and every other file is still restored.
 */
export function rollbackAndFail(
  transaction: FileTransaction,
  failure: RunInstallFailure,
  onLog: OnLog,
): RunInstallResult {
  const outcome = transaction.rollback()
  for (const path of outcome.restored) {
    onLog(() => `[verbose] restored ${path}`)
  }
  if (outcome.kind === 'incomplete') {
    for (const issue of outcome.issues) {
      onLog(() => `[verbose] could not restore ${issue.path} (${issue.kind})`)
    }
  }
  return { ok: false, failure, rollback: outcome }
}
