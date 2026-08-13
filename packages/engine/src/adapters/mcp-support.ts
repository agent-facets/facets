import type { Adapter, McpServerCapability } from '@agent-facets/adapter'

/**
 * Whether a selected adapter can reconcile MCP configuration.
 *
 * A different question from `api-compatibility.ts`, which answers "is this
 * adapter loadable at all?" That one is unconditional and its remedy is
 * always "install a compatible release". This one is conditional on the
 * project actually having MCP work to do, and its two answers have two
 * different remedies — which is why widening `AdapterCompatibilityFailure`
 * would have been wrong.
 */

/**
 * Why one selected adapter cannot do MCP work.
 *
 * One arm, because every loadable adapter states its answer: `mcpServers:
 * false` is a deliberate declaration that this tool has no MCP configuration
 * to write, and no upgrade changes that. An adapter that merely predates the
 * question is not loadable at all — that is an API compatibility failure, with
 * a different remedy, reported before this check runs.
 */
export type McpUnsupportedAdapter = { kind: 'capability-declined'; adapter: string }

/** One selected adapter that can reconcile MCP configuration. */
export interface McpCapableSelection {
  adapter: string
  capability: McpServerCapability
}

/**
 * The result of classifying the complete selected set.
 *
 * All-or-nothing: MCP configuration is project state, and reconciling it
 * into some tools but not others would leave the project in a condition no
 * subsequent run could describe. So a single unsupported adapter fails the
 * whole operation, and the failure names every one of them rather than the
 * first.
 */
export type McpAdapterSupport =
  | { ok: true; capable: readonly McpCapableSelection[] }
  | { ok: false; unsupported: readonly McpUnsupportedAdapter[] }

/**
 * Classify every selected adapter's MCP support.
 *
 * Selection order is preserved, so a report lists adapters in the order the
 * caller chose them.
 */
export function classifyMcpSupport(adapters: readonly Adapter[]): McpAdapterSupport {
  const capable: McpCapableSelection[] = []
  const unsupported: McpUnsupportedAdapter[] = []

  for (const adapter of adapters) {
    if (adapter.mcpServers === false) {
      unsupported.push({ kind: 'capability-declined', adapter: adapter.name })
      continue
    }
    capable.push({ adapter: adapter.name, capability: adapter.mcpServers })
  }

  if (unsupported.length > 0) return { ok: false, unsupported }
  return { ok: true, capable }
}
