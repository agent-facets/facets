import type { Harness, HarnessDefinition } from './types.ts'

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
 *   assetLocations: [
 *     { path: '.opencode', scope: 'project', type: 'directory' },
 *     { path: '~/.config/opencode', scope: 'user', type: 'directory' },
 *   ],
 *   configLocations: [
 *     { path: '.opencode/opencode.jsonc', scope: 'project', type: 'file' },
 *   ],
 *   buildAssetMetadata(data) {
 *     // validate and enrich metadata using arktype or any other library
 *   },
 * })
 * ```
 */
export function defineHarness(definition: HarnessDefinition): Harness {
  // Validate required fields
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('defineHarness: "name" is required and must be a non-empty string')
  }

  if (!Array.isArray(definition.assetLocations)) {
    throw new Error('defineHarness: "assetLocations" is required and must be an array')
  }

  if (!Array.isArray(definition.configLocations)) {
    throw new Error('defineHarness: "configLocations" is required and must be an array')
  }

  if (typeof definition.buildAssetMetadata !== 'function') {
    throw new Error('defineHarness: "buildAssetMetadata" is required and must be a function')
  }

  // Validate each location has required fields
  for (const loc of [...definition.assetLocations, ...definition.configLocations]) {
    if (!loc.path || typeof loc.path !== 'string') {
      throw new Error('defineHarness: each location must have a non-empty "path" string')
    }
    if (!['system', 'user', 'project'].includes(loc.scope)) {
      throw new Error(`defineHarness: location scope must be "system", "user", or "project", got "${loc.scope}"`)
    }
    if (!['directory', 'file'].includes(loc.type)) {
      throw new Error(`defineHarness: location type must be "directory" or "file", got "${loc.type}"`)
    }
  }

  const harness: Harness = {
    name: definition.name,
    assetLocations: Object.freeze([...definition.assetLocations]),
    configLocations: Object.freeze([...definition.configLocations]),
    buildAssetMetadata: definition.buildAssetMetadata.bind(definition),

    // CRUD stubs — full implementations deferred to install pipeline
    createAsset:
      definition.createAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Harness "${definition.name}" does not implement createAsset`)
      }),

    readAsset:
      definition.readAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Harness "${definition.name}" does not implement readAsset`)
      }),

    updateAsset:
      definition.updateAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Harness "${definition.name}" does not implement updateAsset`)
      }),

    deleteAsset:
      definition.deleteAsset?.bind(definition) ??
      (async () => {
        throw new Error(`Harness "${definition.name}" does not implement deleteAsset`)
      }),
  }

  return Object.freeze(harness)
}
