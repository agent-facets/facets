import type { McpServerCapabilityFailure, McpServerDeclaration } from '@agent-facets/adapter'
import type {
  McpConsentRequest,
  McpContractViolation,
  McpDeclarationApproval,
  McpNativeTakeover,
  McpUnsupportedAdapter,
} from '@agent-facets/engine'
import { adapterInstallCommand } from './adapter-install-errors.ts'

/**
 * Shared renderings for MCP configuration failures.
 *
 * Lives here rather than inside one view because the same three values reach
 * three surfaces — the Ink failure block, the `fix:` line, and the
 * non-interactive stderr report — and a user comparing them should not find
 * three different descriptions of one condition.
 *
 * Nothing here renders a declaration. Commands, arguments, environment
 * assignments, and URLs belong only on the approval surface a user is
 * actively reading; every path through this module can end up in a CI log.
 */

/** What an unsupported adapter means, and what to do about it. */
export interface UnsupportedMcpAdapterDescription {
  what: string
  fix: string
}

export function describeUnsupportedMcpAdapter(entry: McpUnsupportedAdapter): UnsupportedMcpAdapterDescription {
  switch (entry.kind) {
    case 'asset-only-api':
      return {
        what: `${entry.adapter} implements adapter API ${entry.apiVersion}, which has no MCP server support`,
        fix: `upgrade it: ${adapterInstallCommand(entry.adapter)}`,
      }
    case 'capability-declined':
      return {
        what: `${entry.adapter} declares no MCP server support`,
        // Deliberately not "upgrade": this adapter answered the question, and
        // the answer will not change with a newer release.
        fix: 'omit the server declarations in facets.json, or deselect this adapter',
      }
  }
}

/** One line naming what an adapter's MCP preparation or application hit. */
export function describeMcpCapabilityFailure(failure: McpServerCapabilityFailure): string {
  switch (failure.code) {
    case 'io-failed':
      return `could not ${failure.operation} ${failure.path}: ${failure.message}`
    case 'parse-failed':
      return `${failure.path} could not be parsed: ${failure.message}`
    case 'validation-failed':
      return `${failure.path} is not in a shape it can safely edit: ${failure.message}`
    case 'conflict':
      return `${failure.path} cannot hold the desired servers without destroying native state: ${failure.message}`
  }
}

/**
 * The exact thing a declaration would run or connect to.
 *
 * Complete and unredacted, unlike the collision report's summary: this is
 * only ever rendered on a consent surface — the approval screen, or the
 * failure that exists to tell a non-interactive caller what `--accept-mcp`
 * would authorize. A user cannot approve execution from an elision.
 */
export function describeDeclarationInFull(declaration: McpServerDeclaration): string[] {
  if (declaration.type === 'http') return [`http ${declaration.url}`]
  const lines = [`stdio ${[declaration.command, ...(declaration.args ?? [])].join(' ')}`]
  for (const [key, value] of Object.entries(declaration.env ?? {})) {
    lines.push(`env ${key}=${value}`)
  }
  return lines
}

/** The heading line for one unapproved declaration. */
export function describeApprovalHeading(entry: McpDeclarationApproval): string {
  const claimants = entry.claimants.map((claimant) => claimant.facet).join(', ')
  const reason = entry.standing.kind === 'declaration-changed' ? 'changed since it was approved' : 'not yet approved'
  return `${entry.identity.effectiveName} (${reason}) — from ${claimants}`
}

/** The heading line for one untracked native entry a plan would take over. */
export function describeTakeoverHeading(entry: McpNativeTakeover): string {
  const verb =
    entry.existing === 'equivalent' ? 'already matches and would be adopted' : 'differs and would be replaced'
  return `${entry.adapter}: ${entry.identity.effectiveName} ${verb}`
}

/** Whether a request has anything to say in each of its two sections. */
export function consentRequestCounts(request: McpConsentRequest): { declarations: number; takeovers: number } {
  return { declarations: request.declarations.length, takeovers: request.takeovers.length }
}

/** One line naming an adapter's breach of the MCP capability contract. */
export function describeMcpContractViolation(violation: McpContractViolation): string {
  switch (violation.kind) {
    case 'document-outside-project':
      return `${violation.adapter} disclosed a configuration document outside the project: ${violation.path}`
    case 'undisclosed-changed-path':
      return `${violation.adapter} changed a document it never disclosed: ${violation.path}`
  }
}
