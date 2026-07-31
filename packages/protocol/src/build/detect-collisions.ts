import type { AssetType, ValidationError } from '@agent-facets/common'
import type { FacetManifest } from '../schemas/facet-manifest.ts'

/**
 * Detects duplicate names WITHIN a single asset type — skills against
 * skills, agents against agents, commands against commands.
 *
 * This is deliberately narrower than the namespace rule and must not be
 * read as the whole story: skills and commands share one materialization
 * namespace (design D9), so a skill and a command with the same name are
 * ALSO invalid. That cross-type rule is enforced by `FacetManifestSchema`'s
 * narrow, which derives it from `MATERIALIZATION_NAMESPACE`. Only agents
 * are genuinely free to share a name with a skill or command.
 *
 * Note this check cannot fire on a JSON-parsed manifest: `Object.keys`
 * never yields duplicates, and duplicate JSON members are rejected by
 * `findDuplicateJsonMembers` before validation. It remains as a guard for
 * manifest values constructed programmatically.
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
