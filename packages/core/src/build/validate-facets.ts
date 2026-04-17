import type { ValidationError } from '@agent-facets/common'
import type { FacetManifest } from '../schemas/facet-manifest.ts'

/**
 * Pattern for compact facets entries: "name@version" or "@scope/name@version".
 * The last `@` before a non-empty version string is the separator.
 */
const COMPACT_FACETS_PATTERN = /^(@?[^@]+)@(.+)$/

/**
 * Validates compact facets entries conform to the "name@version" format.
 * Selective (object) entries are skipped — they have their own structural validation.
 */
export function validateCompactFacets(manifest: FacetManifest): ValidationError[] {
  const errors: ValidationError[] = []

  if (!manifest.facets) return errors

  for (let i = 0; i < manifest.facets.length; i++) {
    const entry = manifest.facets[i]
    if (typeof entry !== 'string') continue

    if (!COMPACT_FACETS_PATTERN.test(entry)) {
      errors.push({
        path: `facets[${i}]`,
        message: `Compact facets entry "${entry}" does not match the expected "name@version" format`,
        expected: '"name@version" or "@scope/name@version"',
        actual: entry,
      })
    }
  }

  return errors
}
