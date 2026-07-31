import type { Adapter } from '@agent-facets/adapter'
import type { CollisionResolver } from '../commit/compose.ts'
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
  /**
   * Proof that {@link prepareRemove} already ran and passed.
   *
   * Consumed ONLY to skip repeating that validation. It carries no project
   * state by construction, so nothing about it can reach the delta: the
   * requested `names` go to the commit verbatim, and the manifest loaded
   * under the lock decides which of them exist.
   */
  prepared?: Extract<RemovePrepareResult, { ok: true }>
  onStage?: (event: StageEvent) => void
  onLog?: OnLog
  signal?: AbortSignal
  /**
   * Interactive collision resolver, forwarded to `runInstall`.
   *
   * Removal only shrinks the desired set, so it cannot introduce a new
   * collision — but it CAN surface one that was already recorded and
   * never resolved. Forwarding keeps that recoverable instead of
   * dead-ending the user in a command that can only report.
   */
  resolveCollisions?: CollisionResolver
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
 *   1. Validate the manifest can be read at all.
 *   2. Build the removals delta from the requested names.
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
  for (const name of names) {
    onLog?.(() => `[verbose]   requesting removal of "${name}"`)
  }

  const removals: Removal[] = names.map((name) => ({ facetName: name }))

  const install = await runInstall({
    projectRoot,
    adapters,
    delta: { additions: [], removals },
    ...(onStage ? { onStage } : {}),
    ...(onLog ? { onLog } : {}),
    ...(signal ? { signal } : {}),
    ...(opts.resolveCollisions ? { resolveCollisions: opts.resolveCollisions } : {}),
  })

  if (!install.ok) {
    return { ok: false, phase: 'install', install }
  }
  return { ok: true, install }
}
