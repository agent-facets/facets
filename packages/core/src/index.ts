// common types (re-exported for convenience)
export type { AssetType, Scope, Validated, ValidationError } from '@agent-facets/common'
// types
export type { ArchiveEntry } from './build/content-hash.ts'
export {
  assembleOuterTar,
  assembleTar,
  BUILD_MANIFEST_NAME,
  collectArchiveEntries,
  compressArchive,
  computeAssetHashes,
  computeContentHash,
  INNER_ARCHIVE_NAME,
} from './build/content-hash.ts'
export { detectNamingCollisions } from './build/detect-collisions.ts'
export type { BuildFailure, BuildProgress, BuildResult, BuildStage } from './build/pipeline.ts'
// build pipeline
export { BUILD_STAGES, runBuildPipeline } from './build/pipeline.ts'
export type { AdapterValidationResult } from './build/validate-adapters.ts'
export { validateAdapterMetadata } from './build/validate-adapters.ts'
export { validateCompactFacets } from './build/validate-facets.ts'
export type { WriteBuildOutputOptions } from './build/write-output.ts'
export { writeBuildOutput } from './build/write-output.ts'
export { writeManifest } from './edit/manifest-writer.ts'
export type { MatchedAsset, MissingAsset, ReconciliationResult } from './edit/reconcile.ts'
export { reconcile } from './edit/reconcile.ts'
// edit
export type { AssetManifestKey, DiscoveredAsset } from './edit/scanner.ts'
export { KEBAB_CASE, scanAssets } from './edit/scanner.ts'
// front matter
export type { FrontMatterResult } from './front-matter.ts'
export { extractFrontMatter, hasFrontMatter } from './front-matter.ts'
export type { ResolvedFacetManifest } from './loaders/facet.ts'
// loaders
export { FACET_MANIFEST_FILE, loadManifest, resolvePrompts } from './loaders/facet.ts'
export { loadServerManifest } from './loaders/server.ts'
export type { BuildManifest } from './schemas/build-manifest.ts'
export { BuildManifestSchema } from './schemas/build-manifest.ts'
export type { FacetManifest } from './schemas/facet-manifest.ts'
// schemas
export { FacetManifestSchema } from './schemas/facet-manifest.ts'
export type { Lockfile, LockfileAssetEntry, LockfileFacet } from './schemas/lockfile.ts'
export { LOCKFILE_VERSION, LockfileSchema } from './schemas/lockfile.ts'
export type { FacetsJson } from './schemas/project-manifest.ts'
export { FacetsJsonSchema } from './schemas/project-manifest.ts'
export type { ServerManifest } from './schemas/server-manifest.ts'
export { ServerManifestSchema } from './schemas/server-manifest.ts'
