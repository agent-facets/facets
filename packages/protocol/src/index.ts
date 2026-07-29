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
export type { ArchiveEntry, FacetArchiveParseFailure, ParseFacetArchiveResult } from './build/content-hash.ts'
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
// strict raw tar-header validation (design D5) — applied to both archive
// layers before any path-keyed selection.
export type {
  RawTarEntry,
  RawTarError,
  RawTarErrorCode,
  RawTarValidationOptions,
  RawTarValidationResult,
} from './build/tar-headers.ts'
export { validateRawTarEntries } from './build/tar-headers.ts'
export { validateContentFiles } from './build/validate-content.ts'
export { validateCompactFacets } from './build/validate-facets.ts'
// integrity
export type {
  ArchiveVerificationFailure,
  AssetIntegrityFailure,
  FacetIntegrityCheck,
  FacetIntegrityFailure,
  GitIntegrityInput,
  GunzipFn,
  GunzipResult,
  IntegrityFailure,
  IntegrityResult,
  RegistryIntegrityInput,
  ValidateFacetArchiveResult,
  VerifiedAsset,
  VerifiedEntry,
  VerifiedFacetArchive,
} from './integrity/index.ts'
export {
  listVerifiedFiles,
  validateFacetArchive,
  verifiedFileHashes,
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
// versioned lockfile parsing (exact lockfileVersion dispatch — `0.2` vs
// current `0.3`, no numeric ordering, no shape-sniffing)
export type {
  LockfileParseFailure,
  ParsedLockfile,
  ParseLockfileResult,
  SupportedLockfile,
  SupportedLockfileAssetEntry,
  SupportedLockfileFacet,
  SupportedLockfileVersion,
} from './loaders/lockfile.ts'
export { lockedDispositionOf, parseLockfileDocument, preserveLockfileExtensions } from './loaders/lockfile.ts'
// versioned project-manifest parsing (exact manifestVersion dispatch —
// legacy unversioned vs current `0.1`, no shape-sniffing, duplicate members
// rejected before dispatch)
export type {
  ParsedProjectManifest,
  ParseProjectManifestResult,
  ProjectManifestParseFailure,
} from './loaders/project-manifest.ts'
export { parseProjectManifestDocument } from './loaders/project-manifest.ts'
export { SERVER_MANIFEST_FILE, validateServerManifest } from './loaders/server.ts'
export { findDuplicateJsonMembers, mapArkErrors, parseJson } from './loaders/validate.ts'
// materialization identity — the canonical derivation of an asset's authored
// archive paths and of the two keys that identify it while materializing:
// the logical collision key (what may not coexist) and the concrete adapter
// key (what is read, written, or deleted). Also the portable path/name fold
// shared by archive planning, raw tar-header validation, and cross-facet
// collision planning.
export {
  ASSET_DIRECTORY,
  ASSET_TYPE_ORDER,
  ASSET_TYPES,
  adapterKey,
  canonicalPrimaryPath,
  collisionKey,
  compareAssetTypes,
  portableCollisionKey,
  SKILL_PRIMARY_FILE,
  skillRootPath,
} from './materialization/identity.ts'
// materialization namespaces (design D9) — the single source of truth for
// which asset types compete for the same names. Skills and commands share
// one namespace; agents occupy another.
export type { MaterializationNamespace } from './materialization/namespace.ts'
export {
  MATERIALIZATION_NAMESPACE,
  materializationNamespace,
  sharesNamespace,
} from './materialization/namespace.ts'
// materialization planner — the pure, deterministic, single-pass rule that
// turns authored contributions plus project overrides into either a
// collision-free plan or the complete list of collisions blocking one.
// Shared by the engine (compose + final validation) and the CLI (live draft
// status), so both agree on what collides.
export type {
  AuthoredAsset,
  CollisionGroup,
  CollisionMember,
  FacetContribution,
  InvalidAlias,
  MaterializationPlan,
  MaterializedAsset,
  PlanMaterializationResult,
  PlannedAsset,
  StaleOverride,
} from './materialization/planner.ts'
export { overrideFor, overrideGroupKey, overridesForType, planMaterialization } from './materialization/planner.ts'
// deterministic ordering — one comparator for every artifact and report whose
// order is part of its contract, so planner output, the removal-refinement
// rebuild, and the lockfile writer cannot disagree.
export { compareCodeUnits } from './ordering.ts'
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
// lockfile schemas — one per exact format version (`0.2`, `0.3`), plus
// `Current*` aliases tracking whichever version a normal install writes.
// Readers stay broader than the writer; the `Supported*` aggregate
// (exported with the loader) is derived from those exact readers, never
// hand-written.
export type {
  CurrentLockfile,
  CurrentLockfileAssetEntry,
  CurrentLockfileFacet,
  Lockfile02,
  Lockfile02AssetEntry,
  Lockfile02Facet,
  Lockfile03,
  Lockfile03AssetEntry,
  Lockfile03Facet,
  LockfileFileRecord,
  LockfileSource,
} from './schemas/lockfile.ts'
export {
  CURRENT_LOCKFILE_VERSION,
  CurrentLockfileSchema,
  LOCKFILE_VERSION_0_2,
  LOCKFILE_VERSION_0_3,
  Lockfile02Schema,
  Lockfile03Schema,
  SUPPORTED_LOCKFILE_VERSIONS,
} from './schemas/lockfile.ts'
// materialization dispositions — the three-arm tagged shape (authored /
// aliased / omitted) plus the two narrower variants derived from it: project
// intent (no `authored`, absence means authored) and resolved on-disk state
// (no `omitted`, which materializes nothing).
export type {
  MaterializationDisposition,
  MaterializedDisposition,
  ProjectAssetOverride,
} from './schemas/materialization.ts'
export {
  cloneDisposition,
  isMaterialized,
  MaterializationDispositionSchema,
  MaterializedDispositionSchema,
  materializedNameOf,
  ProjectAssetOverrideSchema,
  sameDisposition,
} from './schemas/materialization.ts'
// project manifest (`facets.json`) — versioned schemas plus the accessors
// read-only consumers use so a compact and an expanded entry are never
// handled differently by accident.
export type {
  CurrentProjectManifest,
  FacetMaterializationOverrides,
  LegacyProjectManifest,
  ProjectFacetEntry,
} from './schemas/project-manifest.ts'
export {
  CURRENT_PROJECT_MANIFEST_VERSION,
  CurrentProjectManifestSchema,
  facetEntryOverrides,
  facetEntrySource,
  LEGACY_PROJECT_MANIFEST_VERSION,
  LegacyProjectManifestSchema,
  SUPPORTED_PROJECT_MANIFEST_VERSIONS,
} from './schemas/project-manifest.ts'
export type { ServerManifest } from './schemas/server-manifest.ts'
export { ServerManifestSchema } from './schemas/server-manifest.ts'
// version-spec grammar (versions as they appear inside artifacts)
export type { VersionSpec } from './sources/version-spec.ts'
export { resolvesToLatest, satisfies } from './sources/version-spec.ts'
