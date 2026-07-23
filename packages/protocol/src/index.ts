// @agent-facets/protocol — TypeScript reference implementation of the
// facet specification. Public API: schemas, validators, integrity, content
// hashing, front-matter, version-spec grammar.

// front matter — the canonical implementation lives in
// `@agent-facets/common`'s `splitFrontMatter`. We re-export from here so
// that external consumers of `@agent-facets/protocol` (e.g. the cafe
// registry) get the front-matter primitive through protocol's surface
// without taking a separate runtime dep on `common`. `common` is bundled
// into protocol's published tarball via tsdown's `alwaysBundle`.
export { splitFrontMatter } from '@agent-facets/common'
// archive plan — the single shared derivation of archive membership and
// entry classification from a facet manifest (design D3). Build collection,
// hashing, verification, and installation all consume this one operation.
export type {
  ArchivePlanEntry,
  ArchivePlanError,
  ArchivePlanErrorCode,
  ArchivePlanInput,
  ArchivePlanResult,
} from './build/archive-plan.ts'
export { planArchiveEntries, validateSupplementaryPath } from './build/archive-plan.ts'
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
// integrity
export type {
  AssetIntegrityFailure,
  FacetIntegrityCheck,
  FacetIntegrityFailure,
  GitIntegrityInput,
  GunzipFn,
  GunzipResult,
  IntegrityFailure,
  IntegrityResult,
  RegistryIntegrityInput,
  VerifiedArchive,
  VerifiedAsset,
} from './integrity/index.ts'
export {
  validateFacetArchive,
  verifyGitOneCheck,
  verifyHash,
  verifyLockfileOneCheck,
  verifyRegistryThreeCheck,
} from './integrity/index.ts'
// versioned build-manifest parsing (exact facetVersion dispatch, no
// cross-version fallback)
export type {
  BuildManifestParseFailure,
  ParseBuildManifestResult,
  ParsedBuildManifest,
} from './loaders/build-manifest.ts'
export { parseBuildManifestDocument } from './loaders/build-manifest.ts'
// loaders (pure bytes-validators — no I/O)
export type { ResolvedFacetManifest } from './loaders/facet.ts'
export {
  FACET_MANIFEST_FILE,
  resolvePromptsFromMap,
  validateFacetManifest,
  validateLegacyFacetManifest,
} from './loaders/facet.ts'
// versioned lockfile parsing (exact lockfileVersion dispatch — legacy alpha
// `1` vs current `0.2`, no numeric ordering, no shape-sniffing)
export type { LockfileParseFailure, ParsedLockfile, ParseLockfileResult } from './loaders/lockfile.ts'
export { parseLockfileDocument } from './loaders/lockfile.ts'
export { SERVER_MANIFEST_FILE, validateServerManifest } from './loaders/server.ts'
export { findDuplicateJsonMembers, mapArkErrors, parseJson } from './loaders/validate.ts'
// asset-name grammar (Agent Skills spec) — exported so build validators, the
// CLI, and the engine's edit/scaffold machinery all validate skill/command/
// agent names against one canonical grammar. Distinct from facet identity
// (facet-name.ts): asset names are local, never scoped, and allow digit-start.
export type { AssetNameResult, AssetNameSegmentResult } from './schemas/asset-name.ts'
export {
  parseAssetName,
  parseAssetNameSegment,
  validateAssetName,
  validateAssetNameSegment,
} from './schemas/asset-name.ts'
// schemas
export type { BuildManifest, CurrentBuildManifest, LegacyBuildManifest } from './schemas/build-manifest.ts'
export {
  BuildManifestSchema,
  CurrentBuildManifestSchema,
  FACET_ARCHIVE_VERSION,
  LEGACY_FACET_ARCHIVE_VERSION,
  LegacyBuildManifestSchema,
  SUPPORTED_FACET_VERSIONS,
} from './schemas/build-manifest.ts'
export type { FacetManifest } from './schemas/facet-manifest.ts'
export { FacetManifestSchema } from './schemas/facet-manifest.ts'
// legacy 0.1 facet-manifest schema — frozen pre-0.2 rules (multi-segment
// asset names, no shared skill/command namespace, no supplementary files),
// consumed only by legacy archive verification during the compatibility
// window.
export type { LegacyFacetManifest } from './schemas/facet-manifest-legacy.ts'
export { LegacyFacetManifestSchema } from './schemas/facet-manifest-legacy.ts'
// facet identity grammar (slugs + scoped/unscoped facet names) — exported so
// other facet-spec implementations (e.g. the registry enforcing scope
// ownership) validate scopes with the same grammar.
export type { FacetName, FacetNameResult, SlugResult } from './schemas/facet-name.ts'
export { parseFacetName, parseSlug, validateFacetName } from './schemas/facet-name.ts'
export type {
  CurrentLockfile,
  CurrentLockfileAssetEntry,
  CurrentLockfileFacet,
  LegacyLockfile,
  Lockfile,
  LockfileAssetEntry,
  LockfileFacet,
  LockfileFileRecord,
  LockfileSource,
} from './schemas/lockfile.ts'
export {
  CURRENT_LOCKFILE_VERSION,
  CurrentLockfileSchema,
  LEGACY_LOCKFILE_VERSION,
  LegacyLockfileSchema,
  LOCKFILE_VERSION,
  LockfileSchema,
  SUPPORTED_LOCKFILE_VERSIONS,
} from './schemas/lockfile.ts'
export type { FacetsJson } from './schemas/project-manifest.ts'
export { FacetsJsonSchema } from './schemas/project-manifest.ts'
export type { ServerManifest } from './schemas/server-manifest.ts'
export { ServerManifestSchema } from './schemas/server-manifest.ts'
// version-spec grammar (versions as they appear inside artifacts)
export type { VersionSpec } from './sources/version-spec.ts'
export { resolvesToLatest, satisfies } from './sources/version-spec.ts'
