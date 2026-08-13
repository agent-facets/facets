import { ADAPTER_API_VERSION } from './api-version.ts'
import type { McpServerCapability } from './mcp-servers.ts'
import type { AdapterDefinition, McpCapableAdapter } from './types.ts'

/**
 * Whether a value is a complete MCP server capability.
 *
 * "Complete" is the only accepted form. A capability with `prepare` but no
 * `apply` would be an adapter that can promise a change it cannot commit, so
 * it is rejected at definition time rather than discovered mid-transaction.
 * The check is structural because an author may reach this factory from
 * untyped JavaScript, where the type system's guarantee does not apply.
 */
function isCompleteMcpServerCapability<Plan>(value: unknown): value is McpServerCapability<Plan> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const capability = value as Record<string, unknown>
  return typeof capability.prepare === 'function' && typeof capability.apply === 'function'
}

/**
 * Create an adapter from a definition object.
 *
 * Validates the definition shape and provides stub defaults for optional
 * CRUD methods. Returns a frozen `Adapter` object stamped with the SDK's
 * canonical adapter API version (`ADAPTER_API_VERSION`).
 *
 * @example
 * ```ts
 * import { defineAdapter } from '@agent-facets/adapter'
 *
 * export default defineAdapter({
 *   name: 'opencode',
 *   buildAssetMetadata(data) {
 *     // validate and enrich metadata using arktype or any other library
 *   },
 * })
 * ```
 */
export function defineAdapter<Plan = unknown>(definition: AdapterDefinition<Plan>): McpCapableAdapter<Plan> {
  // Validate required fields
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('defineAdapter: "name" is required and must be a non-empty string')
  }

  if (typeof definition.buildAssetMetadata !== 'function') {
    throw new Error('defineAdapter: "buildAssetMetadata" is required and must be a function')
  }

  // Unlike the asset methods below, an omitted or partial `mcpServers` gets no
  // stub fallback. A not-implemented stub is the right answer for an operation
  // the CLI can route around; MCP support is a capability the CLI has to know
  // about *before* it plans a transaction, so an adapter must state it.
  if (definition.mcpServers !== false && !isCompleteMcpServerCapability<Plan>(definition.mcpServers)) {
    throw new Error(
      'defineAdapter: "mcpServers" is required and must be either false or an object with "prepare" and "apply" functions',
    )
  }

  const adapter: McpCapableAdapter<Plan> = {
    name: definition.name,

    // SDK-owned: always the canonical value, even if a non-TypeScript
    // caller sneaks an `apiVersion` past the input type.
    apiVersion: ADAPTER_API_VERSION,

    supportsInstall: definition.supportsInstall,

    mcpServers: definition.mcpServers,

    buildAssetMetadata: definition.buildAssetMetadata.bind(definition),

    // CRUD stubs — adapters that omit an operation return a structured
    // not-implemented failure instead of throwing (errors are values).
    installAsset:
      definition.installAsset?.bind(definition) ??
      (async () => ({
        ok: false as const,
        failure: { code: 'not-implemented' as const, method: 'installAsset' as const },
      })),

    readAsset:
      definition.readAsset?.bind(definition) ??
      (async () => ({
        ok: false as const,
        failure: { code: 'not-implemented' as const, method: 'readAsset' as const },
      })),

    deleteAsset:
      definition.deleteAsset?.bind(definition) ??
      (async () => ({
        ok: false as const,
        failure: { code: 'not-implemented' as const, method: 'deleteAsset' as const },
      })),
  }

  return Object.freeze(adapter)
}
