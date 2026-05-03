import type { FacetManifest } from '@agent-facets/protocol'
import type { AssetManifestKey, DiscoveredAsset } from './scanner.ts'

export interface MissingAsset {
  type: AssetManifestKey
  name: string
  /** The path where the file was expected (e.g., 'skills/review/SKILL.md') */
  expectedPath: string
}

export interface MatchedAsset {
  type: AssetManifestKey
  name: string
  /** Relative path from the facet root */
  path: string
}

export interface ReconciliationResult {
  /** Assets found on disk but not in the manifest */
  additions: DiscoveredAsset[]
  /** Assets in the manifest but missing from disk */
  missing: MissingAsset[]
  /** Assets that exist in both the manifest and on disk */
  matched: MatchedAsset[]
}

/**
 * Compares discovered assets on disk against manifest entries.
 * Produces lists of additions (on disk, not in manifest),
 * missing files (in manifest, not on disk), and matched assets.
 */
export function reconcile(manifest: FacetManifest, discovered: DiscoveredAsset[]): ReconciliationResult {
  const additions: DiscoveredAsset[] = []
  const missing: MissingAsset[] = []
  const matched: MatchedAsset[] = []

  // Build a set of discovered assets keyed by type:name
  const discoveredMap = new Map<string, DiscoveredAsset>()
  for (const asset of discovered) {
    discoveredMap.set(`${asset.type}:${asset.name}`, asset)
  }

  // Check manifest entries against discovered assets
  const assetSections: Array<{ type: AssetManifestKey; entries: Record<string, unknown> | undefined }> = [
    { type: 'skills', entries: manifest.skills },
    { type: 'agents', entries: manifest.agents },
    { type: 'commands', entries: manifest.commands },
  ]

  const manifestKeys = new Set<string>()

  for (const { type, entries } of assetSections) {
    if (!entries) continue
    for (const name of Object.keys(entries)) {
      const key = `${type}:${name}`
      manifestKeys.add(key)

      const onDisk = discoveredMap.get(key)
      if (onDisk) {
        matched.push({ type, name, path: onDisk.path })
      } else {
        const expectedPath = type === 'skills' ? `skills/${name}/SKILL.md` : `${type}/${name}.md`
        missing.push({ type, name, expectedPath })
      }
    }
  }

  // Check discovered assets not in manifest
  for (const asset of discovered) {
    const key = `${asset.type}:${asset.name}`
    if (!manifestKeys.has(key)) {
      additions.push(asset)
    }
  }

  return { additions, missing, matched }
}
