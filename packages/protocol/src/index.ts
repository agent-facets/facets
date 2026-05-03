// @agent-facets/protocol — TypeScript reference implementation of the
// facet specification. Public API: schemas, validators, integrity, content
// hashing, front-matter, version-spec grammar.

// content hashing + archive format (deterministic tar layout, hash format,
// constants — all part of the integrity contract)
export type { ArchiveEntry } from './build/content-hash.ts'
export {
  assembleOuterTar,
  assembleTar,
  BUILD_MANIFEST_NAME,
  collectArchiveEntries,
  computeAssetHashes,
  computeContentHash,
  DETERMINISTIC_ATTRS,
  INNER_ARCHIVE_NAME,
  parseFacetArchive,
  parseInnerArchive,
} from './build/content-hash.ts'
// build validators (artifact-rule checks)
export { detectNamingCollisions } from './build/detect-collisions.ts'
export { validateContentFiles } from './build/validate-content.ts'
export { validateCompactFacets } from './build/validate-facets.ts'
// front matter
export type { FrontMatterResult } from './front-matter.ts'
export { extractFrontMatter, hasFrontMatter } from './front-matter.ts'
// integrity
export type {
  AssetIntegrityFailure,
  FacetIntegrityCheck,
  FacetIntegrityFailure,
  IntegrityFailure,
  IntegrityResult,
} from './integrity/index.ts'
export { verifyGitOneCheck, verifyHash, verifyRegistryThreeCheck } from './integrity/index.ts'
// loaders (pure bytes-validators — no I/O)
export type { ResolvedFacetManifest } from './loaders/facet.ts'
export { FACET_MANIFEST_FILE, resolvePromptsFromMap, validateFacetManifest } from './loaders/facet.ts'
export { SERVER_MANIFEST_FILE, validateServerManifest } from './loaders/server.ts'
export { mapArkErrors, parseJson } from './loaders/validate.ts'
// schemas
export type { BuildManifest } from './schemas/build-manifest.ts'
export { BuildManifestSchema } from './schemas/build-manifest.ts'
export type { FacetManifest } from './schemas/facet-manifest.ts'
export { FacetManifestSchema } from './schemas/facet-manifest.ts'
export type { Lockfile, LockfileAssetEntry, LockfileFacet } from './schemas/lockfile.ts'
export { LOCKFILE_VERSION, LockfileSchema } from './schemas/lockfile.ts'
export type { FacetsJson } from './schemas/project-manifest.ts'
export { FacetsJsonSchema } from './schemas/project-manifest.ts'
export type { ServerManifest } from './schemas/server-manifest.ts'
export { ServerManifestSchema } from './schemas/server-manifest.ts'
// version-spec grammar (versions as they appear inside artifacts)
export type { VersionSpec } from './sources/version-spec.ts'
export { resolvesToLatest } from './sources/version-spec.ts'
