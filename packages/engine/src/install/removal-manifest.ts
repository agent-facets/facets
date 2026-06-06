import type { ResolvedFacetManifest } from '@agent-facets/protocol'

/**
 * Synthesize a placeholder manifest for a facet being removed during
 * drift cleanup. `materialize` only touches `manifest` for the install
 * branch, which is empty (`newAssets: []`) for removals — so the fields
 * here are never read.
 */
export function removalManifest(facetName: string): ResolvedFacetManifest {
  return {
    name: facetName,
    version: '0.0.0',
  }
}
