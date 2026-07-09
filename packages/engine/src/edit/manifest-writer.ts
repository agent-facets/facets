import { join } from 'node:path'
import type { FacetManifest } from '@agent-facets/protocol'
import { FACET_MANIFEST_FILE } from '@agent-facets/protocol'
import { jsonFileText } from '../json-file-text.ts'

/**
 * Writes a facet manifest to disk as `facet.json`.
 * Uses `jsonFileText` (2-space indent per ADR-006, trailing newline).
 */
export async function writeManifest(manifest: FacetManifest, rootDir: string): Promise<void> {
  const path = join(rootDir, FACET_MANIFEST_FILE)
  await Bun.write(path, jsonFileText(manifest))
}
