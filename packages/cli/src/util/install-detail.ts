import type { RunInstallFailure } from '@agent-facets/engine'
import { ACCEPT_MCP_FLAG } from '../commands/shared/flags.ts'
import { writeMaterializationDetail } from './collision-report.ts'
import { formatMcpConsentReport, formatUnsupportedMcpAdaptersReport } from './mcp-report.ts'

/**
 * Write the long-form stderr detail for a failed install-pipeline run, if
 * the failure has one. Returns whether anything was written.
 *
 * One dispatcher over every code, rather than each report owning its own
 * entry point, because the question a command asks is "does this failure
 * need more than three lines?" and that question has one answer per code.
 * Routing MCP failures through a function named for materialization was how
 * they ended up with no stderr detail at all: the collision switch had no
 * arm for them and fell through to `false`.
 *
 * Called before the canonical three-line block so the `fix:` line stays the
 * last thing on the stream, where people look for it.
 */
export function writeInstallFailureDetail(failure: RunInstallFailure): boolean {
  switch (failure.code) {
    case 'MCP_CONSENT_REQUIRED':
      process.stderr.write(`${formatMcpConsentReport(failure.request, ACCEPT_MCP_FLAG)}\n`)
      return true
    case 'MCP_ADAPTERS_UNSUPPORTED':
      process.stderr.write(`${formatUnsupportedMcpAdaptersReport(failure.adapters, failure.servers)}\n`)
      return true
    default:
      return writeMaterializationDetail(failure)
  }
}
