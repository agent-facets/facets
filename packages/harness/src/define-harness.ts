import type { Harness } from './types.ts'

/**
 * Create a harness from a definition object.
 *
 * Validates the definition shape and provides stub defaults for optional
 * CRUD methods. Returns a frozen `Harness` object.
 *
 * @example
 * ```ts
 * import { defineHarness } from '@agent-facets/harness'
 *
 * export default defineHarness({
 *   name: 'opencode',
 *   buildAssetMetadata(data) {
 *     // validate and enrich metadata using arktype or any other library
 *   },
 * })
 * ```
 */
export function defineHarness(definition: Harness): Harness {
  // Validate required fields
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('defineHarness: "name" is required and must be a non-empty string')
  }

  if (typeof definition.buildAssetMetadata !== 'function') {
    throw new Error('defineHarness: "buildAssetMetadata" is required and must be a function')
  }

  const harness: Harness = {
    name: definition.name,

    buildAssetMetadata: definition.buildAssetMetadata.bind(definition),

    // CRUD stubs — full implementations deferred to install pipeline
    installAsset:
      definition.installAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Harness "${definition.name}" does not implement installAsset`)
      }),

    readAsset:
      definition.readAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Harness "${definition.name}" does not implement readAsset`)
      }),

    deleteAsset:
      definition.deleteAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Harness "${definition.name}" does not implement deleteAsset`)
      }),
  }

  return Object.freeze(harness)
}
