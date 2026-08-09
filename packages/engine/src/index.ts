// Engine's public surface is whatever the CLI consumes. Per Decision 1 and
// AGENTS.md, do NOT add speculative exports — anything generally useful for
// third-party implementers belongs in @agent-facets/protocol. Treat the size
// of this file as a litmus test for the engine's package boundary.

// adapter machinery
export type { AdapterCompatibilityFailure, ApiDeclarationClassification } from './adapters/api-compatibility.ts'
export { classifyApiDeclaration, isWellFormedAdapterApi, SUPPORTED_ADAPTER_APIS } from './adapters/api-compatibility.ts'
export type { BundleFailure, BundleResult, ResolvedEntryPoint, ResolveEntryPointResult } from './adapters/bundler.ts'
export { bundleAdapter, rebundleAdapter, resolveEntryPoint } from './adapters/bundler.ts'
export type { FirstPartyAdapter } from './adapters/first-party.ts'
export { FIRST_PARTY_ADAPTERS } from './adapters/first-party.ts'
export type {
  BrokenReason,
  InstalledAdapterInspection,
  RepairSource,
} from './adapters/inspect.ts'
export { inspectInstalledAdapter, inspectInstalledAdapters } from './adapters/inspect.ts'
export type {
  AdapterInstallFailure,
  AdapterInstallOptions,
  AdapterInstallResult,
  AdapterInstallStage,
  LocateAndVerifyResult,
} from './adapters/install-service.ts'
export { installAdapter, locateAndVerifyAdapter } from './adapters/install-service.ts'
export type {
  InstallationReceipt,
  InstallationSource,
  ReadReceiptResult,
} from './adapters/installation.ts'
export {
  INSTALLATION_RECEIPT_NAME,
  isSafeGenerationId,
  readInstallationReceipt,
} from './adapters/installation.ts'
export type { InstalledAdapterFailure, LoadAdaptersResult } from './adapters/loader.ts'
export { loadInstalledAdapters } from './adapters/loader.ts'
export type { McpUnsupportedAdapter } from './adapters/mcp-support.ts'
export type {
  PlaceAdapterFailure,
  PlaceAdapterResult,
  PlacementProvenance,
  PlacementWarning,
} from './adapters/placement.ts'
export {
  getAdapterBaseDir,
  getAdapterBundlePath,
  getAdapterDir,
  listInstalledAdapters,
  placeAdapter,
  placeAdapterManaged,
  removeAdapter,
} from './adapters/placement.ts'
export type { VerifiedAdapter, VerifyAdapterFailure, VerifyAdapterResult } from './adapters/verify.ts'
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
export type {
  ApplyModifyError,
  ApplyModifyResult,
  AssetTarget,
  FacetMetaFields,
  FieldMutation,
  ModifyFileOp,
  ModifyOp,
} from './edit/apply-modify.ts'
export { applyModify, assetPath } from './edit/apply-modify.ts'
export { buildEditContext } from './edit/context.ts'
export {
  addSkillCompanion,
  addTopLevelFile,
  removeSkillCompanion,
  removeTopLevelFile,
} from './edit/declarations.ts'
export { writeManifest } from './edit/manifest-writer.ts'
export type { OperationPreviewLine } from './edit/operation-preview.ts'
export { previewEditOperations } from './edit/operation-preview.ts'
export type { EditApplyResult } from './edit/operations.ts'
export { applyEditOperations, applyModifyFileOps } from './edit/operations.ts'
export type { ReadmeAction, ReadmeActionOption, ReadmeResolution } from './edit/readme-actions.ts'
export {
  applyReadmeDeclaration,
  README_CREATE_DEFAULT,
  readmeActionFor,
  readmeActionOptions,
  readmeFileOperations,
  readmeOptionKindFor,
  readmeSeedContent,
} from './edit/readme-actions.ts'
export type { MatchedAsset, MissingAsset, ReconciliationResult } from './edit/reconcile.ts'
export { reconcile } from './edit/reconcile.ts'
export {
  isAdditionItem,
  optionIndexForResolution,
  optionLabelsFor,
  reconciliationItemKey,
  resolutionForOption,
} from './edit/reconcile-actions.ts'
export type { AssetManifestKey, DiscoveredAsset } from './edit/scanner.ts'
export { COMMON_ROOT_FILES, scanAssets, scanCommonRootFiles, scanSkillCompanions } from './edit/scanner.ts'
export type {
  DeclarationSite,
  EditContext,
  EditOperation,
  EditResult,
  ReadmeFileState,
  ReconciliationItem,
  ReconciliationResolution,
} from './edit/types.ts'
// facet-dir — single source of truth for the facet directory tree
export {
  facetAdaptersDir,
  facetBinDir,
  facetCacheDir,
  facetLocksDir,
  facetReceiptsDir,
  resolveFacetDir,
} from './facet-dir.ts'
export type {
  AssetTakeoverDecision,
  AssetTakeoverRequest,
  AssetTakeoverResolver,
} from './install/asset-takeover.ts'
// The shared cross-domain naming rule. Exported because the CLI's collision
// workspace must answer "does this draft plan cleanly?" with the SAME function
// the engine uses to validate the answer it gets back.
export type {
  CollisionFacetContribution,
  CollisionPlanResult,
  MaterializationAliasProblem,
} from './install/commit/collision-plan.ts'
export { overrideGroupFor, planCollisionIntent } from './install/commit/collision-plan.ts'
// install machinery
// The collision-resolver contract. Exported because the interactive
// workspace lives in the CLI (TTY detection and prompting are display
// concerns) while the rule it must satisfy lives here: return complete
// project overrides, or cancel. Nothing else crosses the boundary.
export type {
  CollisionResolution,
  CollisionResolutionRequest,
  CollisionResolver,
} from './install/commit/compose.ts'
export type { JournalEntry, JournalRollbackOptions, JournalRollbackResult } from './install/journal.ts'
export { InstallJournal } from './install/journal.ts'
export type { AcquireLockError, AcquireLockResult, InstallLock } from './install/lockfile-guard.ts'
export { acquireInstallLock, computeLockPath } from './install/lockfile-guard.ts'
export type { LoadLockfileResult } from './install/lockfile-io.ts'
export { emptyLockfile, FACETS_LOCK_FILE, loadLockfile, writeLockfile } from './install/lockfile-io.ts'
export type { MaterializeOptions, MaterializeResult } from './install/materialize.ts'
export { materialize } from './install/materialize.ts'
// MCP configuration consent. Exported for the same reason the collision
// resolver is: the screen is a display concern the CLI owns, while what
// needs approving — and what an approval means — is an engine rule.
export type {
  McpApprovalStanding,
  McpConsentDecision,
  McpConsentPolicy,
  McpConsentRequest,
  McpConsentResolver,
  McpDeclarationApproval,
  McpNativeTakeover,
} from './install/mcp/consent.ts'
// MCP outcomes. The CLI renders these; the engine decides them.
export type {
  McpActiveConfigurationStatus,
  McpApprovalSummary,
  McpConfigurationOutcome,
  McpConsentOutcome,
  McpConsentRequestSummary,
  McpDispositionOutcome,
  McpInstallOutcomes,
  McpIntentChange,
  McpTakeoverSummary,
  PrunedServerIntent,
} from './install/mcp/outcomes.ts'
export type { McpContractViolation } from './install/mcp/prepare.ts'
// Prototype-safe access to records keyed by user-authored names. The CLI's
// collision draft builds and rewrites exactly such a record before handing it
// back as the resolver's answer, so it needs the same two primitives the
// commit path uses rather than a second copy of them.
export { ownEntry, ownRecord } from './install/own-entry.ts'
// add orchestrator (owns the facet add manifest transaction)
export type { AddPrepareFailure, AddSource, PrepareAddResult, RunAddOptions, RunAddResult } from './install/run-add.ts'
export { prepareAdd, runAdd } from './install/run-add.ts'
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
  Addition,
  AssetIdentity,
  ContributionKind,
  EffectiveAssetName,
  FacetOutcome,
  FacetStage,
  InstallDelta,
  InstallSummary,
  LockfileDriftEntry,
  MaterializationCollisionGroup,
  MaterializationOverrideRef,
  OnLog,
  Removal,
  RollbackOutcome,
  RunInstallFailure,
  RunInstallOptions,
  RunInstallResult,
  StageEvent,
  StaleMaterializationOverride,
} from './install/types.ts'
// `AssetIdentity` names an asset by its EFFECTIVE name, and the brand on
// that field makes the type unconstructible from a bare string. Adapter
// failure shapes carry one, so anything rendering `RunInstallFailure` needs
// the constructor to build a fixture -- exported alongside the type.
export { assetIdentity } from './install/types.ts'
// loaders. Note: `ResolvedFacetManifest` and `FACET_MANIFEST_FILE` are
// part of `@agent-facets/protocol`'s public surface, not engine's. CLI
// imports them directly from protocol; we don't re-export them here to
// avoid two import paths for the same value.
export { loadManifest, resolvePrompts } from './loaders/facet.ts'
// project manifest — the normalized view the install pipeline reasons about,
// plus the comment-preserving document that is the only thing serialized.
export type {
  LoadedManifestVersion,
  ManifestDocument,
  NormalizedFacetEntry,
  NormalizedProjectManifest,
} from './manifest/mutations.ts'
export {
  applyDesiredFacets,
  countOverrides,
  emptyProjectManifest,
  FACETS_JSON_FILE,
  parseProjectManifest,
  serializeProjectManifest,
} from './manifest/mutations.ts'
// manifest project files (I/O bridge)
export type {
  LoadProjectManifestResult,
  ManifestLoadFailure,
  UnsupportedManifestVersion,
} from './manifest/project-files.ts'
export { loadProjectManifest, manifestLoadFailure, writeProjectManifest } from './manifest/project-files.ts'
// readme (shared by scaffold + edit)
export type { ReadmePath } from './readme.ts'
export { isReadmePath, README_EXTENSIONLESS, README_MD, README_PATHS, readmeTemplate } from './readme.ts'
// registry
export type {
  DiscoverArtifactResult,
  DriftResult,
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
  WirePackageListItem,
  WirePackageListResponse,
  WirePublishResponse,
  WireQueuedForReviewBody,
} from './registry/index.ts'
export {
  BUILD_OUTPUT_DIR,
  buildArtifactFilename,
  buildArtifactPath,
  createRegistryClient,
  deleteCredentialsFile,
  describeVersionSpec,
  detectManifestDrift,
  discoverBuiltArtifacts,
  downloadAndExtractFacet,
  encodeFacetName,
  fetchAuthMe,
  fixtures,
  getRegistryBaseUrl,
  publishFacetVersion,
  readCredentialsToken,
  resolveCredential,
  resolveRegistryMetadataBatch,
  translateThrownError,
  translateWireError,
  uncappedGunzip,
  writeCredentialsToken,
} from './registry/index.ts'
// scaffold
export type { ScaffoldOptions, ScaffoldReadme } from './scaffold/index.ts'
export {
  agentTemplate,
  commandTemplate,
  DEFAULT_VERSION,
  generateScaffoldManifest,
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
  NpmResolvedRelease,
  ResolveNpmAdapterResult,
  UsedIntegrity,
  VerifyTarballIntegrityResult,
} from './sources/adapter/npm.ts'
export {
  assertInsideTempDir,
  downloadNpmRelease,
  resolveNpmAdapter,
  verifyTarballIntegrity,
} from './sources/adapter/npm.ts'
export type {
  NpmVersionRequest,
  ParseAdapterSpecifierResult,
  ResolvedAdapterSpecifier,
} from './sources/adapter/specifier.ts'
export { getBuiltinAdapterNames, parseAdapterSpecifier } from './sources/adapter/specifier.ts'
// facet sources
export { parseFacetSource } from './sources/facet/parse-source.ts'
export { parseVersionSpec } from './sources/facet/parse-version.ts'
export type { CloneFacetGitResult } from './sources/facet/resolve-git.ts'
export { cloneFacetGitSource } from './sources/facet/resolve-git.ts'
export type { ResolveLocalFacetResult } from './sources/facet/resolve-local.ts'
export { resolveLocalFacetSource } from './sources/facet/resolve-local.ts'
export type { ParseError, ParseErrorCode, ParseResult, Source } from './sources/facet/types.ts'
