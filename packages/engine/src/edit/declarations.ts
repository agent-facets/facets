import type { FacetManifest } from '@agent-facets/protocol'

/**
 * Pure manifest mutations for supplementary-file declarations. Each returns a
 * new manifest; `files` arrays are kept sorted and de-duplicated so repeated
 * edits produce stable, reviewable diffs. Empty arrays are dropped so the
 * manifest never carries an inert `files: []`.
 */

function withSortedFiles(files: string[]): string[] {
  return Array.from(new Set(files)).sort()
}

/** Add a top-level supplementary declaration (e.g. `README.md`, `LICENSE`). */
export function addTopLevelFile(manifest: FacetManifest, path: string): FacetManifest {
  const files = withSortedFiles([...(manifest.files ?? []), path])
  return { ...manifest, files }
}

/** Remove a top-level supplementary declaration. Drops `files` if it empties. */
export function removeTopLevelFile(manifest: FacetManifest, path: string): FacetManifest {
  const files = (manifest.files ?? []).filter((p) => p !== path)
  const next = { ...manifest }
  if (files.length > 0) next.files = withSortedFiles(files)
  else delete next.files
  return next
}

/** Add a companion declaration (relative to the skill dir) to a skill. */
export function addSkillCompanion(manifest: FacetManifest, skill: string, relPath: string): FacetManifest {
  const descriptor = manifest.skills?.[skill]
  if (!descriptor) return manifest
  const files = withSortedFiles([...(descriptor.files ?? []), relPath])
  return {
    ...manifest,
    skills: { ...manifest.skills, [skill]: { ...descriptor, files } },
  }
}

/** Remove a companion declaration from a skill. Drops the skill `files` if empty. */
export function removeSkillCompanion(manifest: FacetManifest, skill: string, relPath: string): FacetManifest {
  const descriptor = manifest.skills?.[skill]
  if (!descriptor) return manifest
  const files = (descriptor.files ?? []).filter((p) => p !== relPath)
  const nextDescriptor = { ...descriptor }
  if (files.length > 0) nextDescriptor.files = withSortedFiles(files)
  else delete nextDescriptor.files
  return {
    ...manifest,
    skills: { ...manifest.skills, [skill]: nextDescriptor },
  }
}
