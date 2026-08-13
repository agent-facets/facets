import type { McpServerCapabilityFailure, ReadonlyMcpServerDeclaration } from '@agent-facets/adapter'
import type {
  McpConsentRequest,
  McpContractViolation,
  McpDeclarationApproval,
  McpNativeTakeover,
  McpUnsupportedAdapter,
} from '@agent-facets/engine'
import { adapterInstallCommand } from './adapter-install-errors.ts'
import { omitSnippet, serverManifestLocation, UNCHANGED_FOOTER } from './collision-report.ts'
import { consentCommandLine, consentEnvironmentAssignment, consentLiteral } from './consent-literal.ts'

/**
 * Shared renderings for MCP configuration failures.
 *
 * Lives here rather than inside one view because the same three values reach
 * three surfaces — the Ink failure block, the `fix:` line, and the
 * non-interactive stderr report — and a user comparing them should not find
 * three different descriptions of one condition.
 *
 * With one deliberate exception — {@link describeDeclarationInFull} and the
 * consent report built on it — nothing here renders a declaration. Commands,
 * arguments, environment assignments, and URLs belong only on a surface whose
 * purpose is showing a user what they would be authorizing.
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
 *
 * Every value goes through {@link consentLiteral}, so the rendering is
 * complete AND unambiguous: argument boundaries survive, two different argv
 * arrays cannot produce one line, and nothing in a declaration can add a line
 * or issue a terminal control.
 */
export function describeDeclarationInFull(declaration: ReadonlyMcpServerDeclaration): string[] {
  if (declaration.type === 'http') return [`http ${consentLiteral(declaration.url)}`]
  const lines = [`stdio ${consentCommandLine(declaration.command, declaration.args ?? [])}`]
  for (const [key, value] of Object.entries(declaration.env ?? {})) {
    lines.push(`env ${consentEnvironmentAssignment(key, value)}`)
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

/**
 * The full stderr report for a run that needs MCP approval and cannot ask.
 *
 * This is the second of the two surfaces allowed to print a declaration, and
 * it exists for the same reason the collision report does: the rich Ink block
 * goes to stdout, and the situations that produce this failure — CI, a piped
 * command, `--frozen-lockfile` — are exactly the ones where stdout is a log
 * nobody reads. A user deciding whether to pass the approval flag has to be
 * able to see what it would authorize, and `code=MCP_CONSENT_REQUIRED` alone
 * asks them to approve a command they were never shown.
 *
 * Every claimant gets its own omission location, and none is recommended:
 * the alternative to approving is omitting, and which server to omit is not
 * a question this tool has an opinion about.
 */
export function formatMcpConsentReport(request: McpConsentRequest, flag: string): string {
  const lines: string[] = [
    `MCP server configuration needs approval, and this run has no way to ask for it.`,
    `Approving lets your coding tools launch these commands or connect to these URLs.`,
    ``,
  ]

  if (request.declarations.length > 0) {
    lines.push(`  Servers to configure:`)
    for (const entry of request.declarations) {
      lines.push(`    • ${describeApprovalHeading(entry)}`)
      for (const line of describeDeclarationInFull(entry.declaration)) lines.push(`        ${line}`)
      // One location per claimant: an effective identity can be claimed by
      // several facets, and omitting it means editing every one of them.
      for (const claimant of entry.claimants) {
        lines.push(`        omit in ${serverManifestLocation(claimant.facet, claimant.authoredName)}`)
        lines.push(`          ${omitSnippet(claimant.authoredName)}`)
      }
    }
    lines.push(``)
  }

  if (request.takeovers.length > 0) {
    lines.push(`  Existing entries this would take over:`)
    for (const entry of request.takeovers) {
      lines.push(`    • ${describeTakeoverHeading(entry)}`)
      for (const line of describeDeclarationInFull(entry.declaration)) lines.push(`        ${line}`)
    }
    lines.push(``)
  }

  lines.push(
    `  Re-run with --${flag} to approve everything above, or record an omission in facets.json.`,
    ``,
    ...UNCHANGED_FOOTER,
  )
  return lines.join('\n')
}

/**
 * The full stderr report for selected adapters that cannot configure MCP.
 *
 * Carries no declaration, and needs none: neither remedy — upgrade the
 * adapter, or stop asking for the servers — depends on what a server would
 * run. The per-adapter split matters, though, because "upgrade it" is wrong
 * advice for an adapter that answered the question and said no.
 */
export function formatUnsupportedMcpAdaptersReport(
  adapters: readonly McpUnsupportedAdapter[],
  servers: readonly string[],
): string {
  const lines: string[] = [
    `Some selected adapters cannot configure MCP servers, so installation stopped before`,
    `writing anything.`,
    ``,
  ]

  for (const entry of adapters) {
    const described = describeUnsupportedMcpAdapter(entry)
    lines.push(`    • ${described.what}`)
    lines.push(`        fix: ${described.fix}`)
  }
  lines.push(``)

  if (servers.length > 0) {
    lines.push(`  Servers that need configuring: ${servers.join(', ')}`)
    lines.push(
      `  Omitting every one of them in facets.json also resolves this, because an adapter`,
      `  without MCP support only blocks a run that has MCP work to do.`,
      ``,
    )
  }

  lines.push(...UNCHANGED_FOOTER)
  return lines.join('\n')
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
