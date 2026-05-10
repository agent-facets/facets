import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import type { ValidationError } from '@agent-facets/common'
import {
  assembleOuterTar,
  assembleTar,
  collectArchiveEntries,
  computeAssetHashes,
  computeContentHash,
  detectNamingCollisions,
  FACET_MANIFEST_FILE,
  INNER_ARCHIVE_NAME,
  type ResolvedFacetManifest,
  validateCompactFacets,
  validateContentFiles,
} from '@agent-facets/protocol'
import { loadManifest, resolvePrompts } from '../loaders/facet.ts'
import { compressArchive } from './compress.ts'
import { validateAdapterMetadata } from './validate-adapters.ts'

export interface BuildProgress {
  stage: BuildStage
  status: 'running' | 'done' | 'failed'
}

export interface BuildResult {
  ok: true
  data: ResolvedFacetManifest
  warnings: string[]
  /** The complete .facet file bytes (outer uncompressed tar containing manifest + inner archive) */
  archiveBytes: Uint8Array
  integrity: string
  archiveFilename: string
  assetHashes: Record<string, string>
  /** Serialized build-manifest.json content (for --emit-manifest and test verification) */
  manifestJson: string
}

export interface BuildFailure {
  ok: false
  errors: ValidationError[]
  warnings: string[]
}

/** Stage names emitted by the build pipeline via the onProgress callback. */
export const BUILD_STAGES = [
  'Parsing manifest',
  'Resolving prompts',
  'Validating assets',
  'Checking collisions',
  'Validating adapters',
  'Assembling archive',
  'Writing output',
] as const

export type BuildStage = (typeof BUILD_STAGES)[number]

/**
 * Runs the full build pipeline:
 * 1. Parse manifest — read facet.json, parse JSON, validate schema, check constraints
 * 2. Resolve prompts — read prompt files at conventional paths (also verifies files exist)
 * 3. Validate content — no empty files (author front matter is permitted)
 * 4. Check collisions — fail if same name used within an asset type
 * 5. Validate adapters — delegate metadata building to each adapter, warn on unknown
 * 6. Assemble archive — collect entries, compute hashes, build tar, compress
 *
 * Returns the resolved manifest and archive data on success, or collected errors on failure.
 * Warnings are returned in both cases.
 *
 * An optional `onProgress` callback receives stage updates for UI display.
 * The 'Writing output' stage is emitted by name but handled by the caller (BuildView).
 */
export async function runBuildPipeline(
  rootDir: string,
  adapters: Adapter[] = [],
  onProgress?: (progress: BuildProgress) => void,
): Promise<BuildResult | BuildFailure> {
  const warnings: string[] = []

  // Stage 1: Parse manifest
  onProgress?.({ stage: 'Parsing manifest', status: 'running' })

  const loadResult = await loadManifest(rootDir)
  if (!loadResult.ok) {
    onProgress?.({ stage: 'Parsing manifest', status: 'failed' })
    return { ok: false, errors: loadResult.errors, warnings }
  }
  const manifest = loadResult.data

  onProgress?.({ stage: 'Parsing manifest', status: 'done' })

  // Stage 2: Resolve prompts (also serves as file existence verification)
  onProgress?.({ stage: 'Resolving prompts', status: 'running' })

  const resolveResult = await resolvePrompts(manifest, rootDir)
  if (!resolveResult.ok) {
    onProgress?.({ stage: 'Resolving prompts', status: 'failed' })
    return { ok: false, errors: resolveResult.errors, warnings }
  }

  onProgress?.({ stage: 'Resolving prompts', status: 'done' })

  // Stage 3: Validate assets (no empty files; author front matter is OK)
  onProgress?.({ stage: 'Validating assets', status: 'running' })

  const contentErrors = validateContentFiles(resolveResult.data)
  if (contentErrors.length > 0) {
    onProgress?.({ stage: 'Validating assets', status: 'failed' })
    return { ok: false, errors: contentErrors, warnings }
  }

  onProgress?.({ stage: 'Validating assets', status: 'done' })

  // Stage 4: Check naming collisions
  onProgress?.({ stage: 'Checking collisions', status: 'running' })

  const collisionErrors = detectNamingCollisions(manifest)
  const facetsErrors = validateCompactFacets(manifest)
  const checkErrors = [...collisionErrors, ...facetsErrors]
  if (checkErrors.length > 0) {
    onProgress?.({ stage: 'Checking collisions', status: 'failed' })
    return { ok: false, errors: checkErrors, warnings }
  }

  onProgress?.({ stage: 'Checking collisions', status: 'done' })

  // Stage 5: Validate adapter metadata
  onProgress?.({ stage: 'Validating adapters', status: 'running' })

  const adapterResult = validateAdapterMetadata(manifest, adapters)
  if (adapterResult.errors.length > 0) {
    onProgress?.({ stage: 'Validating adapters', status: 'failed' })
    return { ok: false, errors: adapterResult.errors, warnings: [...warnings, ...adapterResult.warnings] }
  }
  warnings.push(...adapterResult.warnings)

  onProgress?.({ stage: 'Validating adapters', status: 'done' })

  // Stage 6: Assemble archive, compute content hashes, and wrap into self-contained .facet
  onProgress?.({ stage: 'Assembling archive', status: 'running' })

  const resolved = resolveResult.data
  const manifestContent = await Bun.file(join(rootDir, FACET_MANIFEST_FILE)).text()
  const entries = collectArchiveEntries(resolved, manifestContent)
  const assetHashes = computeAssetHashes(entries)
  const tarBytes = assembleTar(entries)
  const integrity = computeContentHash(tarBytes)
  const innerArchiveBytes = compressArchive(tarBytes)
  const archiveFilename = `${resolved.name}-${resolved.version}.facet`

  // Build the build manifest and wrap into the outer tar
  const buildManifest = {
    facetVersion: 0.1,
    archive: INNER_ARCHIVE_NAME,
    integrity,
    assets: assetHashes,
  }
  const manifestJson = JSON.stringify(buildManifest, null, 2)
  const archiveBytes = assembleOuterTar(manifestJson, innerArchiveBytes)

  onProgress?.({ stage: 'Assembling archive', status: 'done' })

  return {
    ok: true,
    data: resolved,
    warnings,
    archiveBytes,
    integrity,
    archiveFilename,
    assetHashes,
    manifestJson,
  }
}
