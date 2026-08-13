import type { RollbackOutcome, RunInstallFailure } from '@agent-facets/engine'
import { ACCEPT_MCP_FLAG } from '../commands/shared/flags.ts'
import { writeMaterializationDetail } from './collision-report.ts'
import { describeRollbackIssue, hasPreservedConflicts } from './install-outcome.ts'
import {
  formatMcpConsentReport,
  formatMcpDocumentOverlapReport,
  formatUnsupportedMcpAdaptersReport,
} from './mcp-report.ts'

/**
 * Write the long-form stderr detail for a failed install-pipeline run, if
 * the failure has one. Returns whether anything was written.
 *
 * One dispatcher over every code, rather than each report owning its own
 * entry point, because the question a command asks is "does this failure
 * need more than three lines?" and that question has one answer per code.
 *
 * Rollback detail comes first and is independent of the failure code: any
 * failure can leave a file that could not be put back, and the paths are what
 * a user needs regardless of what went wrong. Reporting it per code is how it
 * ended up reported for none of them.
 *
 * Called before the canonical three-line block so the `fix:` line stays the
 * last thing on the stream, where people look for it.
 */
export function writeInstallFailureDetail(failure: RunInstallFailure, rollback: RollbackOutcome): boolean {
  const wroteRollback = writeRollbackDetail(rollback)
  switch (failure.code) {
    case 'MCP_CONSENT_REQUIRED':
      process.stderr.write(`${formatMcpConsentReport(failure.request, ACCEPT_MCP_FLAG)}\n`)
      return true
    case 'MCP_ADAPTERS_UNSUPPORTED':
      process.stderr.write(`${formatUnsupportedMcpAdaptersReport(failure.adapters, failure.servers)}\n`)
      return true
    case 'MCP_DOCUMENT_OVERLAP':
      process.stderr.write(`${formatMcpDocumentOverlapReport(failure.overlaps)}\n`)
      return true
    default:
      return writeMaterializationDetail(failure) || wroteRollback
  }
}

/**
 * Name every file the rollback could not return to its prior state.
 *
 * Written without prompting and without offering to overwrite anything: a
 * file another process now owns is reported and left exactly as that process
 * left it. Recovering from here is a decision only the user can make, and the
 * paths are what makes it possible.
 */
function writeRollbackDetail(rollback: RollbackOutcome): boolean {
  if (rollback.kind !== 'incomplete') return false

  const lines: string[] = []
  lines.push(
    hasPreservedConflicts(rollback.issues)
      ? 'Some files were changed by something else while this ran and were left as they are:'
      : 'Some files could not be returned to their previous state:',
  )
  for (const issue of rollback.issues) {
    lines.push(`  ${describeRollbackIssue(issue)}`)
  }
  if (rollback.restored.length > 0) {
    lines.push(`  (${rollback.restored.length} other file(s) were restored)`)
  }
  process.stderr.write(`${lines.join('\n')}\n`)
  return true
}
