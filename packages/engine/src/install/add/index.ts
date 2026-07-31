import type { Adapter } from '@agent-facets/adapter'
import type { CollisionResolver } from '../commit/compose.ts'
import { runInstall } from '../run-install.ts'
import type { OnLog, RunInstallResult, StageEvent } from '../types.ts'
import { type AddPrepareFailure, type AddSource, type PrepareAddResult, prepareAdd } from './prepare.ts'

export type { AddPrepareFailure, AddSource, PrepareAddResult }
export { prepareAdd }

export interface RunAddOptions {
  projectRoot: string
  sources: ReadonlyArray<AddSource>
  adapters: ReadonlyArray<Adapter>
  /** Pre-validated state from {@link prepareAdd}. When provided, skips
   *  name resolution and manifest loading (the expensive part). */
  prepared?: Extract<PrepareAddResult, { ok: true }>
  onStage?: (event: StageEvent) => void
  onLog?: OnLog
  signal?: AbortSignal
  /**
   * Interactive collision resolver, forwarded to `runInstall`.
   *
   * `add` is the command most likely to introduce a collision — it is
   * the one that brings a new facet into the set — so omitting this
   * would leave the interactive path unreachable exactly where it is
   * most needed.
   */
  resolveCollisions?: CollisionResolver
}

/**
 * Result of `runAdd`. Discriminated by `ok`.
 */
export type RunAddResult =
  | { ok: true; install: Extract<RunInstallResult, { ok: true }> }
  | { ok: false; phase: 'prepare'; failure: AddPrepareFailure }
  | {
      ok: false
      phase: 'install'
      install: Extract<RunInstallResult, { ok: false }>
    }

/**
 * The `facet add` orchestrator: prepare → commit.
 *
 *   1. Prepare: resolve each source's facet name + load the manifest.
 *      Independently testable via {@link prepareAdd}.
 *   2. Commit: delegate to `runInstall` with the additions delta.
 *
 * No write-ahead manifest mutation. No snapshot/restore. No pin rewrite.
 * The commit phase (`runInstall`) owns all resolution, materialization,
 * and the transactional write of manifest + lockfile + receipt.
 *
 * Never throws.
 */
export async function runAdd(opts: RunAddOptions): Promise<RunAddResult> {
  const { projectRoot, adapters, signal } = opts
  const onStage = opts.onStage
  const onLog = opts.onLog

  // 1. Prepare: resolve names + load manifest (or use pre-validated state).
  const prep = opts.prepared ?? (await prepareAdd(projectRoot, opts.sources, onLog))
  if (!prep.ok) {
    return { ok: false, phase: 'prepare', failure: prep.failure }
  }

  // 2. Commit: delegate to runInstall with the delta.
  const install = await runInstall({
    projectRoot,
    adapters,
    delta: { additions: [...prep.additions], removals: [] },
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
