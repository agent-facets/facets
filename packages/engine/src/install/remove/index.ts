import type { Adapter } from '@agent-facets/adapter'
import { runInstall } from '../run-install.ts'
import type { OnLog, Removal, RunInstallResult, StageEvent } from '../types.ts'
import { prepareRemove, type RemovePrepareFailure, type RemovePrepareResult } from './prepare.ts'

export type { RemovePrepareFailure, RemovePrepareResult }
export { prepareRemove }

export interface RunRemoveOptions {
  projectRoot: string
  /** Facet names (the `facets.json` keys) to remove — not source specifiers. */
  names: ReadonlyArray<string>
  adapters: ReadonlyArray<Adapter>
  /** Pre-validated state from {@link prepareRemove}. */
  prepared?: Extract<RemovePrepareResult, { ok: true }>
  onStage?: (event: StageEvent) => void
  onLog?: OnLog
  signal?: AbortSignal
}

/**
 * Result of `runRemove`. Discriminated by `ok`.
 */
export type RunRemoveResult =
  | { ok: true; install: Extract<RunInstallResult, { ok: true }> }
  | { ok: false; phase: 'prepare'; failure: RemovePrepareFailure }
  | {
      ok: false
      phase: 'install'
      install: Extract<RunInstallResult, { ok: false }>
    }

/**
 * The `facet remove` orchestrator. Pure plan routing:
 *
 *   1. Validate names exist in the manifest.
 *   2. Build the removals delta.
 *   3. Delegate to `runInstall` with the delta.
 *
 * No write-ahead manifest mutation. No snapshot/restore. The commit
 * phase (`runInstall`) merges the delta in memory and writes
 * manifest + lockfile transactionally on success.
 *
 * Never throws.
 */
export async function runRemove(opts: RunRemoveOptions): Promise<RunRemoveResult> {
  const { projectRoot, names, adapters, signal } = opts
  const onStage = opts.onStage
  const onLog = opts.onLog

  const prep = opts.prepared ?? prepareRemove({ projectRoot, names })
  if (!prep.ok) {
    return { ok: false, phase: 'prepare', failure: prep.failure }
  }
  const filteredNames = prep.names

  for (const name of filteredNames) {
    onLog?.(() => `[verbose]   removing "${name}"`)
  }

  const removals: Removal[] = filteredNames.map((name) => ({ facetName: name }))

  const install = await runInstall({
    projectRoot,
    adapters,
    delta: { additions: [], removals },
    ...(onStage ? { onStage } : {}),
    ...(onLog ? { onLog } : {}),
    ...(signal ? { signal } : {}),
  })

  if (!install.ok) {
    return { ok: false, phase: 'install', install }
  }
  return { ok: true, install }
}
