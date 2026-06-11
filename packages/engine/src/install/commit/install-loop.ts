import type { Adapter } from '@agent-facets/adapter'
import type { Lockfile, LockfileFacet } from '@agent-facets/protocol'
import { classifyOutcome } from '../classify-outcome.ts'
import type { InstallJournal } from '../journal.ts'
import { materialize } from '../materialize.ts'
import { materializeFailureToRunInstall } from '../materialize-failure.ts'
import type { FacetOutcome, RunInstallFailure, StageEvent } from '../types.ts'
import { resolveFacet } from './resolve-facet.ts'

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
  onLog: (line: string) => void
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
