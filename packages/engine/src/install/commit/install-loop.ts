import type { Adapter } from '@agent-facets/adapter'
import type { Lockfile, LockfileAssetEntry, LockfileFacet } from '@agent-facets/protocol'
import { classifyOutcome } from '../classify-outcome.ts'
import type { InstallJournal } from '../journal.ts'
import { materialize } from '../materialize.ts'
import { materializeFailureToRunInstall } from '../materialize-failure.ts'
import type { FacetOutcome, OnLog, RunInstallFailure, StageEvent } from '../types.ts'
import { resolveFacet } from './resolve-facet.ts'

/**
 * Accumulates, across the whole install run, which asset owns each resolved
 * on-disk path per adapter. Two DISTINCT assets (different facet/type/name)
 * mapping to the same path is a collision the pipeline refuses before writing
 * — otherwise one silently clobbers the other and drift-deletion of one takes
 * out the other's file.
 *
 * Only adapters that implement the optional `resolvePath` hook participate;
 * adapters whose asset types never share a directory tree opt out by not
 * implementing it. Returns a failure on the first collision, else `null`.
 */
export function detectPathCollisions(
  adapters: ReadonlyArray<Adapter>,
  facet: string,
  assets: ReadonlyArray<LockfileAssetEntry>,
  owners: Map<string, { facet: string; asset: LockfileAssetEntry }>,
): RunInstallFailure | null {
  for (const adapter of adapters) {
    if (!adapter.resolvePath) continue
    for (const asset of assets) {
      const path = adapter.resolvePath(asset.scope, asset.type, asset.name)
      const key = `${adapter.name}\u0000${path}`
      const existing = owners.get(key)
      if (existing) {
        const sameAsset =
          existing.facet === facet &&
          existing.asset.type === asset.type &&
          existing.asset.name === asset.name &&
          existing.asset.scope === asset.scope
        if (!sameAsset) {
          return { code: 'ASSET_PATH_COLLISION', adapter: adapter.name, path, existing, incoming: { facet, asset } }
        }
      } else {
        owners.set(key, { facet, asset })
      }
    }
  }
  return null
}

export interface InstallLoopSuccess {
  /** The lockfile entries resolved this run, keyed by facet name. */
  newFacetEntries: Record<string, LockfileFacet>
  perFacet: FacetOutcome[]
  serverWarnings: { facet: string; servers: ReadonlyArray<string> }[]
  /** Assets actually written across all facets (skipped no-ops don't count). */
  totalAssets: number
}

export type InstallLoopResult = { ok: true; value: InstallLoopSuccess } | { ok: false; failure: RunInstallFailure }

export interface InstallLoopArgs {
  desiredFacets: Readonly<Record<string, string>>
  additionNames: ReadonlySet<string>
  previousLockfile: Lockfile
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  frozenLockfile: boolean
  journal: InstallJournal
  signal?: AbortSignal
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * The per-facet install loop: resolve each desired facet through its
 * source-kind resolver, then materialize its assets under the journal.
 *
 * Returns on the FIRST failure — the caller owns journal rollback, so
 * this function only reports; it never unwinds. Abort is checked at
 * the top of every iteration and surfaces as the `ABORTED` failure.
 */
export async function installFacets(args: InstallLoopArgs): Promise<InstallLoopResult> {
  const { desiredFacets, previousLockfile, adapters, journal, signal, onStage, onLog } = args

  const newFacetEntries: Record<string, LockfileFacet> = {}
  const perFacet: FacetOutcome[] = []
  const serverWarnings: { facet: string; servers: ReadonlyArray<string> }[] = []
  let totalAssets = 0
  // Per-run path ownership, accumulated across facets for the collision check.
  const pathOwners = new Map<string, { facet: string; asset: LockfileAssetEntry }>()

  for (const [facetName, specifier] of Object.entries(desiredFacets)) {
    if (signal?.aborted) {
      return { ok: false, failure: { code: 'ABORTED' } }
    }
    onStage({ kind: 'facet-start', facet: facetName, specifier })

    const resolveResult = await resolveFacet({
      facetName,
      specifier,
      projectRoot: args.projectRoot,
      adapters,
      previousLockfile,
      onStage,
      onLog,
      frozenLockfile: args.frozenLockfile,
      isExplicitAddition: args.additionNames.has(facetName),
    })
    if (!resolveResult.ok) {
      onStage({ kind: 'facet-failure', facet: facetName, failure: resolveResult.failure })
      return { ok: false, failure: resolveResult.failure }
    }

    const { entry, resolved, serversDeclared } = resolveResult.value

    if (serversDeclared.length > 0) {
      serverWarnings.push({ facet: facetName, servers: serversDeclared })
      onStage({ kind: 'server-warning', facet: facetName, servers: serversDeclared })
    }

    // Path-collision preflight — run BEFORE materialize so a colliding
    // asset is refused before any write. Fails the run (rollback unwinds any
    // already-written facet); the user renames one of the colliding assets.
    const collision = detectPathCollisions(adapters, facetName, entry.assets, pathOwners)
    if (collision !== null) {
      onStage({ kind: 'facet-failure', facet: facetName, failure: collision })
      return { ok: false, failure: collision }
    }

    // Materialize.
    const previousEntry = previousLockfile.facets[facetName]
    const oldAssets = previousEntry?.assets ?? []

    onStage({ kind: 'facet-stage', facet: facetName, stage: 'materialize' })
    const materializeResult = await materialize({
      facetName,
      manifest: resolved,
      adapters: [...adapters],
      oldAssets,
      newAssets: entry.assets,
      journal,
      onLog,
      onStage,
    })
    if (!materializeResult.ok) {
      const failure = materializeFailureToRunInstall(facetName, materializeResult.failure)
      onStage({ kind: 'facet-failure', facet: facetName, failure })
      return { ok: false, failure }
    }

    newFacetEntries[facetName] = entry
    totalAssets += materializeResult.written

    // Classify outcome — `repaired` means same lockfile entry but at
    // least one asset needed to be re-written on disk.
    const outcome = classifyOutcome(facetName, previousEntry, entry, materializeResult.written)
    perFacet.push(outcome)
    onStage({ kind: 'facet-success', facet: facetName, outcome })
  }

  return { ok: true, value: { newFacetEntries, perFacet, serverWarnings, totalAssets } }
}
