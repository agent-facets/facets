import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import type { ValidationError } from '@agent-facets/common'
import {
  assembleOuterTar,
  assembleTar,
  computeAssetHashes,
  computeContentHash,
  detectNamingCollisions,
  FACET_ARCHIVE_VERSION,
  FACET_MANIFEST_FILE,
  INNER_ARCHIVE_NAME,
  planArchiveEntries,
  type ResolvedFacetManifest,
  validateCompactFacets,
  validateContentFiles,
} from '@agent-facets/protocol'
import { type AdapterCompatibilityFailure, compatibilityFailureFor } from '../adapters/api-compatibility.ts'
import { jsonFileText } from '../json-file-text.ts'
import { loadManifest, resolvePrompts } from '../loaders/facet.ts'
import { buildArtifactFilename } from '../registry/artifact-path.ts'
import { compressArchive } from './compress.ts'
import {
  collectArchiveEntriesFromPlan,
  type LoadedSupplementaryFile,
  loadSupplementarySources,
  supplementarySourceFailureToValidationError,
} from './load-supplementary-sources.ts'
import { validateAdapterMetadata } from './validate-adapters.ts'

export interface BuildProgress {
  stage: BuildStage
  status: 'running' | 'done' | 'failed'
}

export interface BuildResult {
  ok: true
  data: ResolvedFacetManifest
  warnings: string[]
  /** The emitted archive-format version (currently always `0.2`). */
  facetVersion: number
  /** The complete .facet file bytes (outer uncompressed tar containing manifest + inner archive) */
  archiveBytes: Uint8Array
  integrity: string
  archiveFilename: string
  /**
   * Complete per-entry hash map for every inner-archive entry: `facet.json`,
   * every primary asset, and every supplementary file (skill companions and
   * archive-only files). Keyed by canonical inner-archive path. This is the
   * full `files` map embedded in the `0.2` build manifest, not a
   * primary-asset-only subset.
   */
  fileHashes: Record<string, string>
  /** Serialized build-manifest.json content (for --emit-manifest and test verification) */
  manifestJson: string
}

/**
 * Discriminated build failure:
 *
 *   - `validation` — manifest/content/collision/adapter-metadata errors.
 *   - `adapter-incompatible` — a supplied adapter does not declare a
 *     CLI-supported API. Detected by a preflight before any pipeline
 *     stage runs, so no adapter contract method is ever invoked and the
 *     failure is never conflated with content validation.
 */
export type BuildFailure =
  | { ok: false; kind: 'validation'; errors: ValidationError[]; warnings: string[] }
  | { ok: false; kind: 'adapter-incompatible'; failures: AdapterCompatibilityFailure[]; warnings: string[] }

/** Stage names emitted by the build pipeline via the onProgress callback. */
export const BUILD_STAGES = [
  'Parsing manifest',
  'Resolving prompts',
  'Loading files',
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

  // Stage 0: adapter SDK API preflight — defense-in-depth behind the
  // command-level fail-closed load. Runs before any stage so an
  // incompatible adapter can never reach a contract method or be
  // misreported as a content-validation failure. A build with zero
  // adapters proceeds normally (unknown adapters warn in stage 5).
  const incompatible: AdapterCompatibilityFailure[] = []
  for (const adapter of adapters) {
    const failure = compatibilityFailureFor(adapter.name, adapter.apiVersion)
    if (failure !== null) incompatible.push(failure)
  }
  if (incompatible.length > 0) {
    return { ok: false, kind: 'adapter-incompatible', failures: incompatible, warnings }
  }

  // Stage 1: Parse manifest
  onProgress?.({ stage: 'Parsing manifest', status: 'running' })

  const loadResult = await loadManifest(rootDir)
  if (!loadResult.ok) {
    onProgress?.({ stage: 'Parsing manifest', status: 'failed' })
    return { ok: false, kind: 'validation', errors: loadResult.errors, warnings }
  }
  const manifest = loadResult.data

  onProgress?.({ stage: 'Parsing manifest', status: 'done' })

  // Stage 2: Resolve prompts (also serves as file existence verification)
  onProgress?.({ stage: 'Resolving prompts', status: 'running' })

  const resolveResult = await resolvePrompts(manifest, rootDir)
  if (!resolveResult.ok) {
    onProgress?.({ stage: 'Resolving prompts', status: 'failed' })
    return { ok: false, kind: 'validation', errors: resolveResult.errors, warnings }
  }

  onProgress?.({ stage: 'Resolving prompts', status: 'done' })

  // Stage 2b: Derive the shared archive plan and load every declared
  // supplementary file's exact bytes, validating its resolved source
  // identity (regular file, no links, contained in the tree) BEFORE any
  // output is touched. `planArchiveEntries` re-runs the pure path-grammar
  // and collision checks the manifest schema already narrowed on; a
  // validated manifest always yields `ok: true`, so a plan failure here is
  // defensive. All disk-identity failures preserve previous `dist/` output
  // because the caller only writes on `ok: true`.
  onProgress?.({ stage: 'Loading files', status: 'running' })

  const plan = planArchiveEntries(manifest)
  if (!plan.ok) {
    onProgress?.({ stage: 'Loading files', status: 'failed' })
    return { ok: false, kind: 'validation', errors: plan.errors, warnings }
  }

  const supplementaryResult = await loadSupplementarySources(rootDir, plan.data)
  if (!supplementaryResult.ok) {
    onProgress?.({ stage: 'Loading files', status: 'failed' })
    return {
      ok: false,
      kind: 'validation',
      errors: supplementaryResult.failures.map(supplementarySourceFailureToValidationError),
      warnings,
    }
  }
  const supplementaryFiles: LoadedSupplementaryFile[] = supplementaryResult.files

  onProgress?.({ stage: 'Loading files', status: 'done' })

  // Stage 3: Validate assets (no empty files; author front matter is OK)
  onProgress?.({ stage: 'Validating assets', status: 'running' })

  const contentErrors = validateContentFiles(resolveResult.data)
  if (contentErrors.length > 0) {
    onProgress?.({ stage: 'Validating assets', status: 'failed' })
    return { ok: false, kind: 'validation', errors: contentErrors, warnings }
  }

  onProgress?.({ stage: 'Validating assets', status: 'done' })

  // Stage 4: Check naming collisions
  onProgress?.({ stage: 'Checking collisions', status: 'running' })

  const collisionErrors = detectNamingCollisions(manifest)
  const facetsErrors = validateCompactFacets(manifest)
  const checkErrors = [...collisionErrors, ...facetsErrors]
  if (checkErrors.length > 0) {
    onProgress?.({ stage: 'Checking collisions', status: 'failed' })
    return { ok: false, kind: 'validation', errors: checkErrors, warnings }
  }

  onProgress?.({ stage: 'Checking collisions', status: 'done' })

  // Stage 5: Validate adapter metadata
  onProgress?.({ stage: 'Validating adapters', status: 'running' })

  const adapterResult = validateAdapterMetadata(manifest, adapters)
  if (adapterResult.errors.length > 0) {
    onProgress?.({ stage: 'Validating adapters', status: 'failed' })
    return {
      ok: false,
      kind: 'validation',
      errors: adapterResult.errors,
      warnings: [...warnings, ...adapterResult.warnings],
    }
  }
  warnings.push(...adapterResult.warnings)

  onProgress?.({ stage: 'Validating adapters', status: 'done' })

  // Stage 6: Assemble archive, compute content hashes, and wrap into self-contained .facet
  onProgress?.({ stage: 'Assembling archive', status: 'running' })

  const resolved = resolveResult.data
  const manifestContent = await Bun.file(join(rootDir, FACET_MANIFEST_FILE)).text()
  // Membership and ordering come from the one shared archive plan (design
  // D3) — the same derivation verification consumes — so producer and
  // verifier can never disagree about which paths an archive contains. The
  // plan is pre-sorted, so tar assembly is deterministic.
  const entries = collectArchiveEntriesFromPlan(plan.data, manifestContent, resolved, supplementaryFiles)
  const fileHashes = computeAssetHashes(entries)
  const tarBytes = assembleTar(entries)
  const integrity = computeContentHash(tarBytes)
  const innerArchiveBytes = compressArchive(tarBytes)
  const archiveFilename = buildArtifactFilename(resolved.name, resolved.version)

  // Build the current `0.2` build manifest and wrap into the outer tar.
  // Every build — asset-only or with supplementary files — emits the
  // current flat shape: `facetVersion: 0.2`, the canonical `archive` name,
  // `integrity`, and a complete `files` map (manifest + primaries +
  // supplementary), derived from the shared plan above. `0.1`/`assets`
  // remains a legacy *consumer* input only; producers never emit it. There
  // is no runtime flag or conditional dual-format mode.
  const buildManifest = {
    facetVersion: FACET_ARCHIVE_VERSION,
    archive: INNER_ARCHIVE_NAME,
    integrity,
    files: fileHashes,
  }
  const manifestJson = jsonFileText(buildManifest)
  const archiveBytes = assembleOuterTar(manifestJson, innerArchiveBytes)

  onProgress?.({ stage: 'Assembling archive', status: 'done' })

  return {
    ok: true,
    data: resolved,
    warnings,
    facetVersion: FACET_ARCHIVE_VERSION,
    archiveBytes,
    integrity,
    archiveFilename,
    fileHashes,
    manifestJson,
  }
}
