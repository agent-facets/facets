/**
 * Re-exported from `@agent-facets/common` (which the bundler inlines) so an
 * adapter can satisfy the MCP capability's "one atomic update per document"
 * requirement without hand-rolling tmp-then-rename or taking a dependency an
 * adapter author would have to install separately.
 */
export { atomicWriteFileSync } from '@agent-facets/common'
export type { AdapterApiVersion, AdapterApiVersionAssetsOnly } from './api-version.ts'
export {
  ADAPTER_API_VERSION,
  ADAPTER_API_VERSION_ASSETS_ONLY,
  ADAPTER_API_VERSION_PACKAGE_FIELD,
} from './api-version.ts'
export type { AssetPath, ContainedRelativePathResult } from './asset-fs.ts'
export {
  assembleAssetContent,
  assertSafeAssetName,
  deleteAssetFile,
  deleteSingleFileAsset,
  errorMessage,
  installAssetFile,
  installSingleFileAsset,
  isMissingFileError,
  readAssetFile,
  readSingleFileAsset,
  splitAssetContent,
  validateContainedRelativePath,
} from './asset-fs.ts'
export { defineAdapter } from './define-adapter.ts'
export { isPlainObject, sameStringArray, sameStringRecord } from './mcp-native-values.ts'
export type { McpNativeMatch, ReconcileMcpServersInput } from './mcp-reconcile.ts'
export { mcpDeclarationLiterals, mcpOutcomesRequireWrite, reconcileMcpServers } from './mcp-reconcile.ts'
export type {
  ApplyMcpServersResult,
  McpServerCapability,
  McpServerCapabilityFailure,
  McpServerContribution,
  McpServerDeclaration,
  McpServerOwnership,
  McpServerPreparation,
  McpServerPreparationOutcome,
  PrepareMcpServersRequest,
  PrepareMcpServersResult,
  ReadonlyMcpServerDeclaration,
} from './mcp-servers.ts'
export type {
  ApplyMcpTextPlanOptions,
  InterpolationGuard,
  McpTextPlan,
  PrepareMcpTextPlanInput,
  ReadTextResult,
  TextDocumentEdit,
} from './mcp-text-plan.ts'
export {
  applyMcpTextPlan,
  asMcpTextPlan,
  findInterpolationConflict,
  prepareMcpTextPlan,
  readTextOrAbsent,
} from './mcp-text-plan.ts'
export type { SkillBundlePaths } from './skill-bundle.ts'
export { deleteSkillBundle, installSkillBundle, readSkillBundle } from './skill-bundle.ts'
export type {
  Adapter,
  AdapterAssetFailure,
  AdapterDefinition,
  AdapterMetadata,
  AssetOnlyAdapter,
  AssetType,
  CompanionMap,
  DeleteAssetRequest,
  DeleteAssetResult,
  InstallAssetRequest,
  InstallAssetResult,
  McpCapableAdapter,
  ReadAsset,
  ReadAssetRequest,
  ReadAssetResult,
  Scope,
  Validated,
  ValidationError,
} from './types.ts'
