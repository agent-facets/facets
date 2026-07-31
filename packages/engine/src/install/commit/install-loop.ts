import type { Adapter } from '@agent-facets/adapter'
import type { CurrentLockfileFacet } from '@agent-facets/protocol'
import { classifyOutcome } from '../classify-outcome.ts'
import type { InstallJournal } from '../journal.ts'
import { materialize } from '../materialize.ts'
import { materializeFailureToRunInstall } from '../materialize-failure.ts'
import { ownedPathsForLockedAsset } from '../receipt.ts'
import type { FacetOutcome, OnLog, RunInstallFailure, StageEvent } from '../types.ts'
import { authoredAssetEntries } from '../verified-asset-plan.ts'
import type { ResolvedFacetRecord } from './resolve-all.ts'

export interface InstallLoopSuccess {
  /** The lockfile entries resolved this run, keyed by facet name. */
  newFacetEntries: Record<string, CurrentLockfileFacet>
  perFacet: FacetOutcome[]
  /** Assets actually written across all facets (skipped no-ops don't count). */
  totalAssets: number
}

export type InstallLoopResult = { ok: true; value: InstallLoopSuccess } | { ok: false; failure: RunInstallFailure }

export interface InstallLoopArgs {
  /** Every facet, already resolved and verified. See {@link resolveAll}. */
  resolved: readonly ResolvedFacetRecord[]
  adapters: ReadonlyArray<Adapter>
  journal: InstallJournal
  signal?: AbortSignal
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Materialize every resolved facet under the journal.
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
  const { resolved, adapters, journal, signal, onStage, onLog } = args

  const newFacetEntries: Record<string, CurrentLockfileFacet> = {}
  const perFacet: FacetOutcome[] = []
  let totalAssets = 0

  for (const record of resolved) {
    const { facet: facetName, previousEntry } = record
    if (signal?.aborted) {
      return { ok: false, failure: { code: 'ABORTED' } }
    }

    // Previous ownership comes from the locked entry, normalized here: only
    // this call site knows the entry is a lockfile asset rather than a
    // receipt record, so it is the right place to answer that question.
    const oldAssets = (previousEntry?.assets ?? []).map((asset) => ({
      scope: asset.scope,
      type: asset.type,
      name: asset.name,
      ownedPaths: ownedPathsForLockedAsset(asset),
    }))

    onStage({ kind: 'facet-stage', facet: facetName, stage: 'materialize' })
    const materializeResult = await materialize({
      facetName,
      manifest: record.resolved,
      adapters: [...adapters],
      oldAssets,
      newAssets: record.plan.assets,
      companionBytes: record.companionBytes,
      journal,
      onLog,
      onStage,
    })
    if (!materializeResult.ok) {
      const failure = materializeFailureToRunInstall(facetName, materializeResult.failure)
      onStage({ kind: 'facet-failure', facet: facetName, failure })
      return { ok: false, failure }
    }

    newFacetEntries[facetName] = {
      source: record.source,
      version: record.version,
      integrity: record.integrity,
      assets: authoredAssetEntries(record.plan),
    }
    totalAssets += materializeResult.written

    // Classify outcome — `repaired` means the same locked version but at
    // least one asset needed to be re-written on disk.
    const outcome = classifyOutcome(facetName, previousEntry, record.version, materializeResult.written)
    perFacet.push(outcome)
    onStage({ kind: 'facet-success', facet: facetName, outcome })
  }

  return { ok: true, value: { newFacetEntries, perFacet, totalAssets } }
}
