import type { RemovalMigrationContext, RollbackOutcome, RunInstallFailure } from '@agent-facets/engine'
import { ACCEPT_MCP_FLAG } from '../commands/shared/flags.ts'
import { formatMaterializationDetail } from './collision-report.ts'
import { describeRollbackIssue, hasPreservedConflicts } from './install-outcome.ts'
import {
  formatMcpConsentReport,
  formatMcpDocumentOverlapReport,
  formatServerInventoryMismatchReport,
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
export function writeInstallFailureDetail(
  failure: RunInstallFailure,
  rollback: RollbackOutcome,
  removalMigration?: RemovalMigrationContext,
): boolean {
  const detail = formatInstallFailureDetail(failure, rollback, removalMigration)
  if (!detail) return false
  process.stderr.write(detail)
  return true
}

/**
 * Why a removal resolved its remaining facets at all, in one line.
 *
 * Shown alongside the actual failure, never instead of it: the cause is
 * whatever acquisition or verification step failed, and the remedy for that
 * is the failure's own. This only answers "why did removing something need
 * the network?".
 */
export function describeRemovalMigration(context: RemovalMigrationContext): string {
  return (
    `facets.lock v${context.lockfileVersion} records no MCP server inventory, so this removal had to ` +
    `resolve and verify the remaining facets to write v${context.requiredVersion}; that resolution failed:`
  )
}

/** Preserve the same recovery details when the caller emits a JSON document. */
export function formatInstallFailureDetail(
  failure: RunInstallFailure,
  rollback: RollbackOutcome,
  removalMigration?: RemovalMigrationContext,
): string {
  const migrationDetail = removalMigration === undefined ? '' : `${describeRemovalMigration(removalMigration)}\n`
  const rollbackDetail = formatRollbackDetail(rollback)
  let detail: string
  switch (failure.code) {
    case 'MCP_CONSENT_REQUIRED':
      detail = `${formatMcpConsentReport(failure.request, ACCEPT_MCP_FLAG)}\n`
      break
    case 'MCP_ADAPTERS_UNSUPPORTED':
      detail = `${formatUnsupportedMcpAdaptersReport(failure.adapters, failure.servers)}\n`
      break
    case 'MCP_DOCUMENT_OVERLAP':
      detail = `${formatMcpDocumentOverlapReport(failure.overlaps)}\n`
      break
    case 'RECONCILE_SERVER_IDENTITY':
    case 'RECONCILE_SERVER_FINGERPRINT':
      // Without this the only trace on stderr — and in `update --json` — is the
      // failure code, which names no facet and no server.
      detail = `${formatServerInventoryMismatchReport(failure)}\n`
      break
    default:
      detail = formatMaterializationDetail(failure)
  }
  return rollbackDetail + migrationDetail + detail
}

/**
 * Name every file the rollback could not return to its prior state.
 *
 * Written without prompting and without offering to overwrite anything: a
 * file another process now owns is reported and left exactly as that process
 * left it. Recovering from here is a decision only the user can make, and the
 * paths are what makes it possible.
 */
function formatRollbackDetail(rollback: RollbackOutcome): string {
  if (rollback.kind !== 'incomplete') return ''

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
  return `${lines.join('\n')}\n`
}
