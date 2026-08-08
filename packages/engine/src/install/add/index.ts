import type { Adapter } from '@agent-facets/adapter'
import type { AssetTakeoverResolver } from '../asset-takeover.ts'
import type { CollisionResolver } from '../commit/compose.ts'
import type { McpConsentPolicy } from '../mcp/consent.ts'
import { runInstall } from '../run-install.ts'
import type { OnLog, RunInstallResult, StageEvent } from '../types.ts'
import { type AddPrepareFailure, type AddSource, type PrepareAddResult, prepareAdd } from './prepare.ts'

export type { AddPrepareFailure, AddSource, PrepareAddResult }
export { prepareAdd }

export interface RunAddOptions {
  projectRoot: string
  sources: ReadonlyArray<AddSource>
  adapters: ReadonlyArray<Adapter>
  /**
   * Pre-validated state from {@link prepareAdd}. When provided, skips
   * name resolution and manifest loading (the expensive part).
   *
   * Its `manifest` is ADVISORY ONLY — it was read outside the project lock,
   * so it may already be stale. Only `additions` is forwarded to the commit;
   * threading the snapshot into `runInstall` would reintroduce the
   * pre-lock-read race the lock ordering exists to close.
   */
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
  /**
   * How this invocation may obtain MCP configuration approval, forwarded to
   * `runInstall`. Present on all three front doors because all three enter
   * the same commit pipeline and reconcile the same remaining facets.
   */
  mcpConsent?: McpConsentPolicy
  /**
   * Just-in-time gate for an occupied asset destination this machine does not
   * own, forwarded to `runInstall`. Absence continues, preserving existing
   * non-interactive behavior.
   */
  resolveAssetTakeover?: AssetTakeoverResolver
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
    ...(opts.mcpConsent ? { mcpConsent: opts.mcpConsent } : {}),
    ...(opts.resolveAssetTakeover ? { resolveAssetTakeover: opts.resolveAssetTakeover } : {}),
  })

  if (!install.ok) {
    return { ok: false, phase: 'install', install }
  }
  return { ok: true, install }
}
