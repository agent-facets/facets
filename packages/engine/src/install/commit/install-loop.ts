import type { Adapter } from '@agent-facets/adapter'
import type { CurrentLockfileFacet, MaterializedAsset } from '@agent-facets/protocol'
import type { FileTransaction } from '../../fs/index.ts'
import type { AssetTakeoverResolver } from '../asset-takeover.ts'
import { materialize } from '../materialize.ts'
import { materializeFailureToRunInstall } from '../materialize-failure.ts'
import type { OnLog, RunInstallFailure, StageEvent } from '../types.ts'
import type { ComposedPlan } from './compose.ts'
import type { PreviousOwnership } from './ownership.ts'
import type { ResolvedFacetRecord } from './resolve-all.ts'

export interface InstallLoopSuccess {
  /** The lockfile entries resolved this run, keyed by facet name. */
  newFacetEntries: Record<string, CurrentLockfileFacet>
  /**
   * Assets written per facet, keyed by facet name.
   *
   * Evidence rather than a verdict. A facet's outcome also depends on whether
   * its MCP declarations had to be reconciled, and that happens after every
   * asset is on disk — so this loop reports what it did and the orchestrator
   * classifies once both halves are known.
   */
  assetWrites: ReadonlyMap<string, number>
  /** Assets actually written across all facets (skipped no-ops don't count). */
  totalAssets: number
}

export type InstallLoopResult = { ok: true; value: InstallLoopSuccess } | { ok: false; failure: RunInstallFailure }

export interface InstallLoopArgs {
  /** Every facet, already resolved and verified. See {@link resolveAll}. */
  resolved: readonly ResolvedFacetRecord[]
  /** The collision-free global plan. See {@link compose}. */
  plan: ComposedPlan
  /**
   * The global previous-ownership index, keyed by effective adapter identity.
   * Obsolete identities have already been deleted; what remains here tells
   * each write which owned companion paths its replacement may remove.
   */
  previousOwnership: ReadonlyMap<string, PreviousOwnership>
  /** The project this run is installing into, handed to every adapter request. */
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  transaction: FileTransaction
  /**
   * Interactive gate for an occupied destination this machine does not own.
   * Forwarded verbatim; absence means continue.
   */
  resolveAssetTakeover?: AssetTakeoverResolver
  signal?: AbortSignal
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Materialize every resolved facet through the run's transaction.
 *
 * The second half of what used to be one interleaved loop. Everything this
 * touches was already fetched and verified by {@link resolveAll}, so a
 * failure here is a write failure, never a fetch failure — which is what
 * makes the journal meaningful: every entry it holds corresponds to a
 * mutation that actually happened.
 *
 * Returns on the FIRST failure. The caller owns rollback, so this function
 * only reports; it never unwinds.
 */
export async function installFacets(args: InstallLoopArgs): Promise<InstallLoopResult> {
  const {
    resolved,
    plan,
    previousOwnership,
    projectRoot,
    adapters,
    transaction,
    resolveAssetTakeover,
    signal,
    onStage,
    onLog,
  } = args

  // Entries come from Compose, which is where dispositions were decided.
  // Apply reports what it wrote; it does not re-derive what should be locked.
  const newFacetEntries: Record<string, CurrentLockfileFacet> = { ...plan.facetEntries }
  const assetWrites = new Map<string, number>()
  let totalAssets = 0

  // Assets to write, per facet, carrying both identities. Omitted assets are
  // absent: they remain in the lockfile (the resolved SET) but are never
  // materialized.
  //
  // Writes are safe to group by facet because the plan guarantees every
  // effective identity is unique — two facets can no longer target the same
  // file, so no ordering between them can decide a winner. Deletion had no
  // such guarantee, which is why it moved to a global pass that already ran.
  const materializedByFacet = new Map<string, MaterializedAsset[]>()
  for (const asset of plan.materialized) {
    const list = materializedByFacet.get(asset.facet)
    if (list) list.push(asset)
    else materializedByFacet.set(asset.facet, [asset])
  }

  for (const record of resolved) {
    const facetName = record.facet
    if (signal?.aborted) {
      return { ok: false, failure: { code: 'ABORTED' } }
    }

    onStage({ kind: 'facet-stage', facet: facetName, stage: 'materialize' })
    const materializeResult = await materialize({
      facetName,
      manifest: record.resolved,
      adapters: [...adapters],
      newAssets: materializedByFacet.get(facetName) ?? [],
      previousOwnership,
      companionBytes: record.companionBytes,
      projectRoot,
      transaction,
      ...(resolveAssetTakeover ? { resolveAssetTakeover } : {}),
      onLog,
      onStage,
    })
    if (!materializeResult.ok) {
      const failure = materializeFailureToRunInstall(facetName, materializeResult.failure)
      onStage({ kind: 'facet-failure', facet: facetName, failure })
      return { ok: false, failure }
    }

    totalAssets += materializeResult.written
    assetWrites.set(facetName, materializeResult.written)
  }

  return { ok: true, value: { newFacetEntries, assetWrites, totalAssets } }
}
