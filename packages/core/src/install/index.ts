export {
  InstallJournal,
  type JournalEntry,
  type JournalRollbackOptions,
  type JournalRollbackResult,
} from './journal.ts'
export { type AcquireLockResult, acquireInstallLock, type InstallLock } from './lockfile-guard.ts'
export {
  emptyLockfile,
  FACETS_LOCK_FILE,
  type LoadLockfileResult,
  loadLockfile,
  writeLockfile,
} from './lockfile-io.ts'
export {
  computeAssetList,
  diffAssetsForDeletion,
  type MaterializeOptions,
  materialize,
} from './materialize.ts'
export { type LoadFacetsJsonResult, loadFacetsJson, writeFacetsJson } from './project-files.ts'
export { cloneGitSource, type ResolveGitResult } from './resolve-git.ts'
export { type ResolveLocalResult, resolveLocalSource } from './resolve-local.ts'
export { runInstall } from './run-install.ts'
export type {
  FacetOutcome,
  FacetStage,
  InstallSummary,
  RunInstallFailure,
  RunInstallOptions,
  RunInstallResult,
  StageEvent,
} from './types.ts'
