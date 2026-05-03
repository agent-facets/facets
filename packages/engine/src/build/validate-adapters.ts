import type { Adapter } from '@agent-facets/adapter'
import type { ValidationError } from '@agent-facets/common'
import type { FacetManifest } from '@agent-facets/protocol'

export interface AdapterValidationResult {
  errors: ValidationError[]
  warnings: string[]
}

/**
 * Validates adapter metadata for all assets that declare `adapters`.
 * Each adapter's `buildAssetMetadata()` is called to validate and enrich the metadata.
 * Unknown adapters (in manifest but no matching adapter provided) produce a warning.
 */
export function validateAdapterMetadata(manifest: FacetManifest, adapters: Adapter[]): AdapterValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  // Build a lookup map from adapter name to adapter object
  const adapterMap = new Map<string, Adapter>()
  for (const adapter of adapters) {
    adapterMap.set(adapter.name, adapter)
  }

  // Check skills
  if (manifest.skills) {
    for (const [name, skill] of Object.entries(manifest.skills)) {
      if (skill.adapters) {
        validateAssetAdapters(`skills.${name}`, skill.adapters, adapterMap, errors, warnings)
      }
    }
  }

  // Check agents
  if (manifest.agents) {
    for (const [name, agent] of Object.entries(manifest.agents)) {
      if (agent.adapters) {
        validateAssetAdapters(`agents.${name}`, agent.adapters, adapterMap, errors, warnings)
      }
    }
  }

  return { errors, warnings }
}

function validateAssetAdapters(
  assetPath: string,
  adapterConfigs: Record<string, unknown>,
  adapterMap: Map<string, Adapter>,
  errors: ValidationError[],
  warnings: string[],
): void {
  for (const [adapterName, config] of Object.entries(adapterConfigs)) {
    const adapter = adapterMap.get(adapterName)

    if (!adapter) {
      warnings.push(`${assetPath}: unknown adapter "${adapterName}" — metadata will not be validated`)
      continue
    }

    const result = adapter.buildAssetMetadata(config)
    if (!result.ok) {
      for (const err of result.errors) {
        errors.push({
          path: err.path ? `${assetPath}.adapters.${adapterName}.${err.path}` : `${assetPath}.adapters.${adapterName}`,
          message: `Invalid adapter metadata for "${adapterName}" on ${assetPath}: ${err.message}`,
          expected: err.expected,
          actual: err.actual,
        })
      }
    }
  }
}
