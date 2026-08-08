import type { Adapter, AdapterApiVersionAssetsOnly, McpServerCapability } from '@agent-facets/adapter'
// Subpath import: dependency-free, so this stays out of the full SDK runtime
// graph for the same reason `api-compatibility.ts` does.
import { ADAPTER_API_VERSION_ASSETS_ONLY } from '@agent-facets/adapter/api-version'

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
 * Two arms rather than one shape with an optional API token, because the
 * remedies genuinely differ: an asset-only adapter predates the question and
 * may gain support in a later release, while `mcpServers: false` is a
 * deliberate statement that this tool has no MCP configuration to write.
 * Upgrading the second one will never help.
 */
export type McpUnsupportedAdapter =
  /** Published against the superseded asset-only contract. */
  | { kind: 'asset-only-api'; adapter: string; apiVersion: AdapterApiVersionAssetsOnly }
  /** Current contract, explicitly declining MCP support. */
  | { kind: 'capability-declined'; adapter: string }

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
 * Narrows on the `apiVersion` tag rather than probing for an `mcpServers`
 * field: the adapter union is tagged precisely so this question is answered
 * by the type system, and a structural probe would silently accept a `0.1`
 * adapter that happened to carry an unrelated member of that name.
 *
 * Selection order is preserved, so a report lists adapters in the order the
 * caller chose them.
 */
export function classifyMcpSupport(adapters: readonly Adapter[]): McpAdapterSupport {
  const capable: McpCapableSelection[] = []
  const unsupported: McpUnsupportedAdapter[] = []

  for (const adapter of adapters) {
    if (adapter.apiVersion === ADAPTER_API_VERSION_ASSETS_ONLY) {
      unsupported.push({ kind: 'asset-only-api', adapter: adapter.name, apiVersion: adapter.apiVersion })
      continue
    }
    if (adapter.mcpServers === false) {
      unsupported.push({ kind: 'capability-declined', adapter: adapter.name })
      continue
    }
    capable.push({ adapter: adapter.name, capability: adapter.mcpServers })
  }

  if (unsupported.length > 0) return { ok: false, unsupported }
  return { ok: true, capable }
}
