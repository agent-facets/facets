import { ADAPTER_API_VERSION } from './api-version.ts'
import type { McpServerCapability } from './mcp-servers.ts'
import type { Adapter, AdapterDefinition, AssetCapability } from './types.ts'

/**
 * Whether a value is a complete asset capability.
 *
 * "Complete" is the only accepted form. A capability that can plan an install
 * but not a removal is an adapter that can put files on disk and never take
 * them off, so it is rejected at definition time rather than discovered when a
 * facet is removed. The check is structural because an author may reach this
 * factory from untyped JavaScript, where the type system's guarantee does not
 * apply.
 */
function isCompleteAssetCapability(value: unknown): value is AssetCapability {
  if (typeof value !== 'object' || value === null) return false
  const capability = value as Record<string, unknown>
  return typeof capability.planInstall === 'function' && typeof capability.planRemoval === 'function'
}

/** Whether a value is a complete MCP server capability. */
function isCompleteMcpServerCapability(value: unknown): value is McpServerCapability {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Record<string, unknown>).plan === 'function'
}

/**
 * Create an adapter from a definition object.
 *
 * Validates the definition shape and returns a frozen `Adapter` stamped with
 * the SDK's canonical adapter SDK API version (`ADAPTER_API_VERSION`).
 *
 * Both capabilities are required fields with an explicit `false`. There are no
 * stub defaults: a capability the CLI must know about *before* it plans a
 * transaction cannot be discovered by calling it and being refused.
 *
 * @example
 * ```ts
 * import { defineAdapter } from '@agent-facets/adapter'
 *
 * export default defineAdapter({
 *   name: 'opencode',
 *   assets: false,
 *   mcpServers: false,
 *   buildAssetMetadata(data) {
 *     // validate and enrich metadata using arktype or any other library
 *   },
 * })
 * ```
 */
export function defineAdapter(definition: AdapterDefinition): Adapter {
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('defineAdapter: "name" is required and must be a non-empty string')
  }

  if (typeof definition.buildAssetMetadata !== 'function') {
    throw new Error('defineAdapter: "buildAssetMetadata" is required and must be a function')
  }

  if (definition.assets !== false && !isCompleteAssetCapability(definition.assets)) {
    throw new Error(
      'defineAdapter: "assets" is required and must be either false or an object with "planInstall" and "planRemoval" functions',
    )
  }

  if (definition.mcpServers !== false && !isCompleteMcpServerCapability(definition.mcpServers)) {
    throw new Error(
      'defineAdapter: "mcpServers" is required and must be either false or an object with a "plan" function',
    )
  }

  const adapter: Adapter = {
    name: definition.name,

    // SDK-owned: always the canonical value, even if a non-TypeScript caller
    // sneaks an `apiVersion` past the input type.
    apiVersion: ADAPTER_API_VERSION,

    assets: definition.assets,
    mcpServers: definition.mcpServers,

    buildAssetMetadata: definition.buildAssetMetadata.bind(definition),
  }

  return Object.freeze(adapter)
}
