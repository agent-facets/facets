/**
 * Re-exported from `@agent-facets/common` (which the bundler inlines) so an
 * adapter can describe file states and mutations without taking a dependency
 * an adapter author would have to install separately.
 */
export type {
  FileMutation,
  FileMutationAction,
  FileState,
  InspectFileFailure,
  RegularFileState,
} from '@agent-facets/common'
/**
 * `inspectFileState` is deliberately NOT re-exported: its signature names
 * `node:fs`'s `Stats`, which would drag a Node type reference into the
 * published declarations of a package third-party authors install. Planning
 * goes through `readFileState`, which returns this SDK's own failure
 * vocabulary anyway.
 */
export { bytesEqual, fileStatesEqual, regularFile } from '@agent-facets/common'
export type { AdapterApiVersion } from './api-version.ts'
export { ADAPTER_API_VERSION, ADAPTER_API_VERSION_PACKAGE_FIELD } from './api-version.ts'
export type { AssetFileTarget, ContainedRelativePathResult } from './asset-fs.ts'
export {
  assembleAssetContent,
  assertSafeAssetName,
  encodeText,
  errorMessage,
  isStrictlyInside,
  planFailureForInspection,
  planSingleFileInstall,
  planSingleFileRemoval,
  readFileState,
  splitAssetContent,
  stateHoldsBytes,
  validateContainedRelativePath,
} from './asset-fs.ts'
export { defineAdapter } from './define-adapter.ts'
export { isPlainObject, sameStringArray, sameStringRecord } from './mcp-native-values.ts'
export type { McpNativeMatch, ReconcileMcpServersInput } from './mcp-reconcile.ts'
export { mcpDeclarationLiterals, mcpOutcomesRequireWrite, reconcileMcpServers } from './mcp-reconcile.ts'
export type {
  McpConflictFailure,
  McpServerCapability,
  McpServerCapabilityFailure,
  McpServerContribution,
  McpServerDeclaration,
  McpServerOwnership,
  McpServerPreparationOutcome,
  McpServersPlan,
  PlanMcpServersRequest,
  PlanMcpServersResult,
  ReadonlyMcpServerDeclaration,
} from './mcp-servers.ts'
export type {
  InterpolationGuard,
  McpTextDocument,
  PrepareMcpTextPlanInput,
  ReadTextResult,
  TextDocumentEdit,
} from './mcp-text-plan.ts'
export { findInterpolationConflict, prepareMcpTextPlan, readTextOrAbsent } from './mcp-text-plan.ts'
export type { SkillBundleContent, SkillBundleTarget } from './skill-bundle.ts'
export { planSkillBundleInstall, planSkillBundleRemoval } from './skill-bundle.ts'
export { terminalCommandLine, terminalEnvironmentAssignment, terminalLiteral } from './terminal.ts'
export type {
  Adapter,
  AdapterDefinition,
  AdapterMetadata,
  AdapterPlanFailure,
  AssetCapability,
  AssetInstallPlan,
  AssetOccupancy,
  AssetRemovalPlan,
  AssetRequestContext,
  AssetType,
  CompanionMap,
  MutateAction,
  PlanAssetInstallRequest,
  PlanAssetInstallResult,
  PlanAssetRemovalRequest,
  PlanAssetRemovalResult,
  Scope,
  Validated,
  ValidationError,
} from './types.ts'
