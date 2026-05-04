import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildResult } from './pipeline.ts'

const DIST_DIR = 'dist'
const BUILD_MANIFEST_FILE = 'build-manifest.json'

export interface WriteBuildOutputOptions {
  /** When true, also write a loose build-manifest.json to dist/ alongside the .facet file. */
  emitManifest?: boolean
}

/**
 * Writes the build output to dist/.
 *
 * - Cleans (removes and recreates) the dist/ directory
 * - Writes the self-contained .facet archive (outer uncompressed tar)
 * - Optionally writes a loose build-manifest.json when emitManifest is true
 */
export async function writeBuildOutput(
  result: BuildResult,
  rootDir: string,
  options: WriteBuildOutputOptions = {},
): Promise<void> {
  const distDir = join(rootDir, DIST_DIR)

  // Clean previous output
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  // Write the .facet archive (self-contained outer tar)
  await Bun.write(join(distDir, result.archiveFilename), result.archiveBytes)

  // Optionally write loose build manifest
  if (options.emitManifest) {
    await Bun.write(join(distDir, BUILD_MANIFEST_FILE), result.manifestJson)
  }
}
