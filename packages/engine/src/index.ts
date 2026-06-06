// Engine's public surface is whatever the CLI consumes. Per Decision 1 and
// AGENTS.md, do NOT add speculative exports — anything generally useful for
// third-party implementers belongs in @agent-facets/protocol. Treat the size
// of this file as a litmus test for the engine's package boundary.

// adapter machinery
export type { BundleResult, ResolvedEntryPoint } from './adapters/bundler.ts'
export { bundleAdapter, rebundleAdapter, resolveEntryPoint } from './adapters/bundler.ts'
export type { FirstPartyAdapter } from './adapters/first-party.ts'
export { FIRST_PARTY_ADAPTERS } from './adapters/first-party.ts'
export type {
  AdapterInstallFailure,
  AdapterInstallOptions,
  AdapterInstallResult,
  AdapterInstallStage,
} from './adapters/install-service.ts'
export { installAdapter, locateAndVerifyAdapter } from './adapters/install-service.ts'
export { loadInstalledAdapters } from './adapters/loader.ts'
export {
  getAdapterBaseDir,
  getAdapterBundlePath,
  getAdapterDir,
  listInstalledAdapters,
  placeAdapter,
  removeAdapter,
} from './adapters/placement.ts'
export { verifyAdapter } from './adapters/verify.ts'
// build (engine-side: gzip compression — protocol provides the deterministic
// tar layout and integrity hash; engine compresses for delivery)
export { compressArchive } from './build/compress.ts'
export type { BuildFailure, BuildProgress, BuildResult, BuildStage } from './build/pipeline.ts'
export { BUILD_STAGES, runBuildPipeline } from './build/pipeline.ts'
export type { AdapterValidationResult } from './build/validate-adapters.ts'
export { validateAdapterMetadata } from './build/validate-adapters.ts'
export type { WriteBuildOutputOptions } from './build/write-output.ts'
export { writeBuildOutput } from './build/write-output.ts'
// cache
export type {
  CacheIdentity,
  CacheIntegrity,
  CacheLookup,
  CachePutResult,
  CachePutVerifiedResult,
  CacheSlotCorruption,
} from './cache/index.ts'
export {
  CACHE_INTEGRITY_FILE,
  CacheIntegritySchema,
  cacheGet,
  cachePath,
  cachePut,
  cachePutVerified,
  cacheSlot,
  cacheSlotIsDir,
  cacheStagingDir,
  readCachedIntegrity,
  resolveCacheRoot,
} from './cache/index.ts'
// edit
export { buildEditContext } from './edit/context.ts'
export { writeManifest } from './edit/manifest-writer.ts'
export { applyEditOperations } from './edit/operations.ts'
export type { MatchedAsset, MissingAsset, ReconciliationResult } from './edit/reconcile.ts'
export { reconcile } from './edit/reconcile.ts'
export type { AssetManifestKey, DiscoveredAsset } from './edit/scanner.ts'
export { KEBAB_CASE, scanAssets } from './edit/scanner.ts'
export type {
  EditContext,
  EditOperation,
  EditResult,
  ReconciliationItem,
  ReconciliationResolution,
} from './edit/types.ts'
// facet-dir — single source of truth for the facet directory tree
export { facetAdaptersDir, facetBinDir, facetCacheDir, facetLocksDir, resolveFacetDir } from './facet-dir.ts'
// install machinery
export type { JournalEntry, JournalRollbackOptions, JournalRollbackResult } from './install/journal.ts'
export { InstallJournal } from './install/journal.ts'
export type { AcquireLockError, AcquireLockResult, InstallLock } from './install/lockfile-guard.ts'
export { acquireInstallLock, computeLockPath } from './install/lockfile-guard.ts'
export type { LoadLockfileResult } from './install/lockfile-io.ts'
export { emptyLockfile, FACETS_LOCK_FILE, loadLockfile, writeLockfile } from './install/lockfile-io.ts'
export type { MaterializeOptions, MaterializeResult } from './install/materialize.ts'
export { computeAssetList, diffAssetsForDeletion, materialize } from './install/materialize.ts'
// add orchestrator (owns the facet add manifest transaction)
export type { AddPrepareFailure, AddSource, RunAddOptions, RunAddResult } from './install/run-add.ts'
export { runAdd } from './install/run-add.ts'
// install orchestrator
export { runInstall } from './install/run-install.ts'
// remove orchestrator (owns the facet remove manifest transaction)
export type {
  RemovePrepareFailure,
  RemovePrepareResult,
  RunRemoveOptions,
  RunRemoveResult,
} from './install/run-remove.ts'
export { prepareRemove, runRemove } from './install/run-remove.ts'
export type {
  FacetOutcome,
  FacetStage,
  InstallSummary,
  LockfileDriftEntry,
  RollbackOutcome,
  RunInstallFailure,
  RunInstallOptions,
  RunInstallResult,
  StageEvent,
} from './install/types.ts'
// loaders. Note: `ResolvedFacetManifest` and `FACET_MANIFEST_FILE` are
// part of `@agent-facets/protocol`'s public surface, not engine's. CLI
// imports them directly from protocol; we don't re-export them here to
// avoid two import paths for the same value.
export { loadManifest, resolvePrompts } from './loaders/facet.ts'
export { loadServerManifest } from './loaders/server.ts'
// manifest mutations
export {
  emptyFacetsJson,
  FACETS_JSON_FILE,
  parseFacetsJson,
  removeFacetFromManifest,
  serializeFacetsJson,
  upsertFacetInManifest,
} from './manifest/mutations.ts'
// manifest project files (I/O bridge)
export type { LoadFacetsJsonResult } from './manifest/project-files.ts'
export { loadFacetsJson, writeFacetsJson } from './manifest/project-files.ts'
// registry
export type {
  PublishArgs,
  PublishResult,
  RegistryClientConfig,
  RegistryError,
  RegistryMetadata,
  RegistryResult,
  RegistrySpec,
  ResolvedCredential,
  RetryConfig,
  TimeoutConfig,
  WireAssetCounts,
  WireAuthMeResponse,
  WireErrorCode,
  WireErrorResponse,
  WireHealthResponse,
  WireMetadataResponse,
  WirePackageInfoResponse,
  WirePackageListItem,
  WirePackageListResponse,
  WirePublishResponse,
  WireQueuedForReviewBody,
} from './registry/index.ts'
export {
  createRegistryClient,
  deleteCredentialsFile,
  describeVersionSpec,
  downloadAndExtractFacet,
  encodeFacetName,
  fetchAuthMe,
  getRegistryBaseUrl,
  packFacetSource,
  publishFacetVersion,
  readCredentialsToken,
  resolveCredential,
  resolveRegistryMetadataBatch,
  translateThrownError,
  translateWireError,
  writeCredentialsToken,
} from './registry/index.ts'
// scaffold
export type { ScaffoldOptions } from './scaffold/index.ts'
export {
  agentTemplate,
  commandTemplate,
  DEFAULT_VERSION,
  generateScaffoldManifest,
  isValidKebabCase,
  isValidSemVer,
  previewScaffoldFiles,
  SEMVER,
  skillTemplate,
  writeScaffold,
} from './scaffold/index.ts'
// self-update
export type { DetectDependencies } from './self-update/detect.ts'
export { detectInstallMethod } from './self-update/detect.ts'
export type { RunSelfUpdateOptions } from './self-update/index.ts'
export { runSelfUpdate } from './self-update/index.ts'
export { runCurlInstaller } from './self-update/methods/curl.ts'
export { spawnInherit } from './self-update/methods/spawn-inherit.ts'
export type {
  InstallMethod,
  MethodKind,
  SelfUpdateErrorEvent,
  SelfUpdateErrorHandler,
  UpdateOptions,
} from './self-update/methods/types.ts'
export { installMethods } from './self-update/registry.ts'
export type { LatestVersionResult } from './self-update/version-check.ts'
export { getLatestVersion } from './self-update/version-check.ts'
// adapter sources
export type { CloneAdapterGitResult } from './sources/adapter/git.ts'
export { cloneAdapterGitRepository } from './sources/adapter/git.ts'
export type { ResolveLocalAdapterResult } from './sources/adapter/local.ts'
export { resolveLocalAdapterPath } from './sources/adapter/local.ts'
export type {
  AssertInsideTempDirResult,
  DownloadNpmResult,
  VerifyTarballIntegrityResult,
} from './sources/adapter/npm.ts'
export { assertInsideTempDir, downloadNpmPackage, verifyTarballIntegrity } from './sources/adapter/npm.ts'
export type { ParseAdapterSpecifierResult, ResolvedAdapterSpecifier } from './sources/adapter/specifier.ts'
export { getBuiltinAdapterNames, parseAdapterSpecifier } from './sources/adapter/specifier.ts'
// facet sources
export { parseFacetSource } from './sources/facet/parse-source.ts'
export { parseVersionSpec } from './sources/facet/parse-version.ts'
export type { CloneFacetGitResult } from './sources/facet/resolve-git.ts'
export { cloneFacetGitSource } from './sources/facet/resolve-git.ts'
export type { ResolveLocalFacetResult } from './sources/facet/resolve-local.ts'
export { resolveLocalFacetSource } from './sources/facet/resolve-local.ts'
export type { ParseError, ParseErrorCode, ParseResult, Source } from './sources/facet/types.ts'
