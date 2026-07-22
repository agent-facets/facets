import { ADAPTER_API_VERSION } from './api-version.ts'
import type { Adapter, AdapterDefinition } from './types.ts'

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
export function defineAdapter(definition: AdapterDefinition): Adapter {
  // Validate required fields
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('defineAdapter: "name" is required and must be a non-empty string')
  }

  if (typeof definition.buildAssetMetadata !== 'function') {
    throw new Error('defineAdapter: "buildAssetMetadata" is required and must be a function')
  }

  const adapter: Adapter = {
    name: definition.name,

    // SDK-owned: always the canonical value, even if a non-TypeScript
    // caller sneaks an `apiVersion` past the input type.
    apiVersion: ADAPTER_API_VERSION,

    supportsInstall: definition.supportsInstall,

    buildAssetMetadata: definition.buildAssetMetadata.bind(definition),

    // CRUD stubs — full implementations deferred to install pipeline
    installAsset:
      definition.installAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Adapter "${definition.name}" does not implement installAsset`)
      }),

    readAsset:
      definition.readAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Adapter "${definition.name}" does not implement readAsset`)
      }),

    deleteAsset:
      definition.deleteAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Adapter "${definition.name}" does not implement deleteAsset`)
      }),
  }

  return Object.freeze(adapter)
}
