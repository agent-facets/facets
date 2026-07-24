import type { FacetManifest } from '@agent-facets/protocol'
import { README_PATHS, type ReadmePath } from '../readme.ts'
import type { ReadmeFileState } from './types.ts'

/** On-disk facts for the two conventional README paths. */
export interface ReadmeDiskFacts {
  /** Decoded text content for each README path that exists on disk. */
  present: Partial<Record<ReadmePath, string>>
}

/**
 * Derive one independent state per conventional README path from the manifest's
 * top-level `files` declarations and disk presence. Each path is classified
 * exactly once into one of the four tagged states; there is no representable
 * "present and absent" combination.
 */
export function computeReadmeStates(manifest: FacetManifest, facts: ReadmeDiskFacts): ReadmeFileState[] {
  const declaredFiles = new Set(manifest.files ?? [])
  return README_PATHS.map((path): ReadmeFileState => {
    const isDeclared = declaredFiles.has(path)
    const content = facts.present[path]
    if (content !== undefined) {
      return isDeclared ? { path, state: 'present-declared', content } : { path, state: 'present-undeclared', content }
    }
    return isDeclared ? { path, state: 'declared-missing' } : { path, state: 'absent-undeclared' }
  })
}
