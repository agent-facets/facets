/**
 * Shared conformance fixtures for adapter capabilities.
 *
 * Workspace-only and test-only: nothing here is published, and no adapter's
 * `src/index.ts` imports it, so it never reaches a built bundle. It exists so
 * the three first-party adapters prove the *same* behavior rather than three
 * hand-written approximations of it.
 */
export { commitMutations, commitPlannedAction, currentFileState } from './apply-plan.ts'
export type { AssertDistBundleOptions } from './dist-contract.ts'
export { assertDistBundleContract, loadDistMcpCapability } from './dist-contract.ts'
export type { McpMatrixCase, McpMatrixCaseId, McpMatrixExpectation } from './mcp-matrix.ts'
export {
  EXTENDED_SERVER,
  HTTP_SERVER,
  MCP_MATRIX_CASES,
  OBSOLETE_NAME,
  STDIO_SERVER,
  STDIO_SERVER_MINIMAL,
  UNOWNED_NAME,
} from './mcp-matrix.ts'
export type { DeclarationReference, DeclarationReferenceKind } from './module-specifiers.ts'
export { declarationReferences, runtimeModuleSpecifiers } from './module-specifiers.ts'
export type { McpMatrixProject, McpMatrixSeed, RunMcpServerMatrixOptions } from './run-mcp-matrix.ts'
export { runMcpServerMatrix } from './run-mcp-matrix.ts'
