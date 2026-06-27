import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BUILD_OUTPUT_DIR } from '../registry/artifact-path.ts'
import type { BuildResult } from './pipeline.ts'

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
  const distDir = join(rootDir, BUILD_OUTPUT_DIR)

  // Clean previous output
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  // Write the .facet archive (self-contained outer tar). For a scoped
  // (`@scope/name`) or slash-containing unscoped (`acme/name`) facet
  // identity, `archiveFilename` embeds the slash and renders as a nested
  // path under dist/ (e.g. `dist/@scope/name-1.0.0.facet`). `Bun.write`
  // does not create parent directories, so create the archive's parent
  // first. For a flat name, `dirname` is `distDir` (already created above),
  // making this a no-op.
  const archivePath = join(distDir, result.archiveFilename)
  await mkdir(dirname(archivePath), { recursive: true })
  await Bun.write(archivePath, result.archiveBytes)

  // Optionally write loose build manifest
  if (options.emitManifest) {
    await Bun.write(join(distDir, BUILD_MANIFEST_FILE), result.manifestJson)
  }
}
