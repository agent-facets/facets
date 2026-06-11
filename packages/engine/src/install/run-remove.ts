/**
 * Re-export from the `remove/` module. The orchestrator, types, and helpers
 * now live in `install/remove/` for independent testability.
 */
export type { RemovePrepareFailure, RemovePrepareResult, RunRemoveOptions, RunRemoveResult } from './remove/index.ts'
export { prepareRemove, runRemove } from './remove/index.ts'
