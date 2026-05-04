import type { AssetType, ValidationError } from '@agent-facets/common'
import type { FacetManifest } from '../schemas/facet-manifest.ts'

/**
 * Detects naming collisions within each asset type.
 * Skills must have unique names within skills, agents within agents,
 * and commands within commands. Cross-type duplicates are allowed —
 * a skill and an agent may share the same name.
 */
export function detectNamingCollisions(manifest: FacetManifest): ValidationError[] {
  const errors: ValidationError[] = []

  const checkDuplicates = (names: string[], type: AssetType) => {
    const seen = new Set<string>()
    for (const name of names) {
      if (seen.has(name)) {
        errors.push({
          path: name,
          message: `Naming collision: "${name}" is declared more than once in ${type}s`,
          expected: `unique name within ${type}s`,
          actual: `"${name}" appears multiple times in ${type}s`,
        })
      } else {
        seen.add(name)
      }
    }
  }

  if (manifest.skills) checkDuplicates(Object.keys(manifest.skills), 'skill')
  if (manifest.agents) checkDuplicates(Object.keys(manifest.agents), 'agent')
  if (manifest.commands) checkDuplicates(Object.keys(manifest.commands), 'command')

  return errors
}
