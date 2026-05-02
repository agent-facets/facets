import type { ValidationError } from '@agent-facets/common'
import type { ResolvedFacetManifest } from '../loaders/facet.ts'

/**
 * Validates resolved prompt content for all assets:
 * - No empty files (zero bytes or whitespace only)
 *
 * Author-supplied YAML front matter is permitted and is preserved verbatim
 * in the archive. Front matter is reconciled with the manifest only at
 * install time: `materialize` merges the manifest's `name`, `description`,
 * and any per-adapter extras on top of whatever the author wrote, and the
 * adapter SDK writes the merged result to disk. See
 * `packages/adapter/src/asset-fs.ts#assembleAssetContent`.
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
      }
    }
  }

  return errors
}
