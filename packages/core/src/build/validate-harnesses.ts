import type { ValidationError } from '@agent-facets/common'
import type { Harness } from '@agent-facets/harness'
import type { FacetManifest } from '../schemas/facet-manifest.ts'

export interface HarnessValidationResult {
  errors: ValidationError[]
  warnings: string[]
}

/**
 * Validates harness metadata for all assets that declare `harnesses`.
 * Each harness's `buildAssetMetadata()` is called to validate and enrich the metadata.
 * Unknown harnesses (in manifest but no matching harness provided) produce a warning.
 */
export function validateHarnessMetadata(manifest: FacetManifest, harnesses: Harness[]): HarnessValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  // Build a lookup map from harness name to harness object
  const harnessMap = new Map<string, Harness>()
  for (const harness of harnesses) {
    harnessMap.set(harness.name, harness)
  }

  // Check skills
  if (manifest.skills) {
    for (const [name, skill] of Object.entries(manifest.skills)) {
      if (skill.harnesses) {
        validateAssetHarnesses(`skills.${name}`, skill.harnesses, harnessMap, errors, warnings)
      }
    }
  }

  // Check agents
  if (manifest.agents) {
    for (const [name, agent] of Object.entries(manifest.agents)) {
      if (agent.harnesses) {
        validateAssetHarnesses(`agents.${name}`, agent.harnesses, harnessMap, errors, warnings)
      }
    }
  }

  return { errors, warnings }
}

function validateAssetHarnesses(
  assetPath: string,
  harnessConfigs: Record<string, unknown>,
  harnessMap: Map<string, Harness>,
  errors: ValidationError[],
  warnings: string[],
): void {
  for (const [harnessName, config] of Object.entries(harnessConfigs)) {
    const harness = harnessMap.get(harnessName)

    if (!harness) {
      warnings.push(`${assetPath}: unknown harness "${harnessName}" — metadata will not be validated`)
      continue
    }

    const result = harness.buildAssetMetadata(config)
    if (!result.ok) {
      for (const err of result.errors) {
        errors.push({
          path: err.path
            ? `${assetPath}.harnesses.${harnessName}.${err.path}`
            : `${assetPath}.harnesses.${harnessName}`,
          message: `Invalid harness metadata for "${harnessName}" on ${assetPath}: ${err.message}`,
          expected: err.expected,
          actual: err.actual,
        })
      }
    }
  }
}
