import { join } from 'node:path'
import { FACET_MANIFEST_FILE } from '../loaders/facet.ts'
import type { FacetManifest } from '../schemas/facet-manifest.ts'

/**
 * Writes a facet manifest to disk as `facet.json`.
 * Uses `JSON.stringify(data, null, 2)` per [ADR-6](https://www.notion.so/exmachina-co/ADR-6).
 */
export async function writeManifest(manifest: FacetManifest, rootDir: string): Promise<void> {
  const path = join(rootDir, FACET_MANIFEST_FILE)
  await Bun.write(path, JSON.stringify(manifest, null, 2))
}
