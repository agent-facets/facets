import type { ValidationError } from '@agent-facets/common'
import { hasFrontMatter } from '../front-matter.ts'
import type { ResolvedFacetManifest } from '../loaders/facet.ts'

/**
 * Validates resolved prompt content for all assets:
 * - No YAML front matter (manifest is the single source of truth for metadata)
 * - No empty files (zero bytes or whitespace only)
 *
 * Returns an array of validation errors, one per offending file.
 */
export function validateContentFiles(resolved: ResolvedFacetManifest): ValidationError[] {
  const errors: ValidationError[] = []

  const assetTypes = [
    { type: 'skills', assets: resolved.skills },
    { type: 'agents', assets: resolved.agents },
    { type: 'commands', assets: resolved.commands },
  ] as const

  for (const { type, assets } of assetTypes) {
    if (!assets) continue
    for (const [name, asset] of Object.entries(assets)) {
      const relativePath = type === 'skills' ? `skills/${name}/SKILL.md` : `${type}/${name}.md`

      // Check for empty content
      if (asset.prompt.trim().length === 0) {
        errors.push({
          path: `${type}.${name}`,
          message: `File is empty: ${relativePath}. Content files must contain prompt content.`,
          expected: 'non-empty content',
          actual: 'empty or whitespace only',
        })
        continue // Skip front matter check on empty files
      }

      // Check for YAML front matter
      if (hasFrontMatter(asset.prompt)) {
        errors.push({
          path: `${type}.${name}`,
          message: `File contains YAML front matter: ${relativePath}. The manifest is the source of truth for metadata — use \`facet edit\` to reconcile.`,
          expected: 'no front matter',
          actual: 'front matter detected',
        })
      }
    }
  }

  return errors
}
