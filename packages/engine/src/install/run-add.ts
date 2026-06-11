/**
 * Re-export from the `add/` module. The orchestrator, types, and helpers
 * now live in `install/add/` for independent testability.
 */
export type { AddPrepareFailure, AddSource, PrepareAddResult, RunAddOptions, RunAddResult } from './add/index.ts'
export { prepareAdd, runAdd } from './add/index.ts'
