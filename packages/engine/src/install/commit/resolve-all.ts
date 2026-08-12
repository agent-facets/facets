import type { Adapter } from '@agent-facets/adapter'
import { compareCodeUnits, type SupportedLockfile, type SupportedLockfileFacet } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { ownEntry } from '../own-entry.ts'
import type { OnLog, RunInstallFailure, StageEvent } from '../types.ts'
import { reconcileLockedAgainstPlan } from './reconcile.ts'
import { resolveFacet } from './resolve-facet.ts'
import type { ResolvedFacet } from './types.ts'

/**
 * One fully resolved facet, ready for Compose: everything the resolver
 * verified, plus the facet's key and the entry it was locked at.
 *
 * `previousEntry` is the LOADED state — possibly legacy, possibly absent —
 * and is kept deliberately separate from the freshly verified content above
 * it. Carrying it here means neither Compose nor Apply reaches back into the
 * previous lockfile for a second lookup; outcome classification and
 * ownership diffing both need it, and re-reading it in three places invites
 * the three of them to disagree.
 */
export interface ResolvedFacetRecord extends ResolvedFacet {
  facet: string
  previousEntry: SupportedLockfileFacet | undefined
}

export interface ResolveAllSuccess {
  /** Sorted by facet name. See the ordering note on {@link resolveAll}. */
  resolved: readonly ResolvedFacetRecord[]
}

export type ResolveAllResult = { ok: true; value: ResolveAllSuccess } | { ok: false; failure: RunInstallFailure }

export interface ResolveAllArgs {
  desiredFacets: Readonly<Record<string, NormalizedFacetEntry>>
  additionNames: ReadonlySet<string>
  previousLockfile: SupportedLockfile
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  frozenLockfile: boolean
  signal?: AbortSignal
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Resolve every desired facet before anything is written.
 *
 * This is the first half of what used to be one interleaved loop. The
 * separation is not a tidiness exercise: cross-facet collision detection
 * needs the COMPLETE desired asset set to exist before the first adapter
 * write, which is impossible while facet N is materialized before facet
 * N+1 is fetched.
 *
 * Ordering is by facet name, deliberately, and not the manifest's own key
 * order. Which facet fails first is user-visible, and keying it on however
 * the user happened to sort `facets.json` makes the same broken project
 * report different failures to different people. Sorting also matches the
 * protocol planner, so the two phases agree on what "first" means.
 *
 * No adapter I/O method — `readAsset`, `installAsset`, `deleteAsset` — is
 * invoked here. Building a Git or local facet does call the pure
 * `buildAssetMetadata` validator, which performs no I/O and never receives
 * an asset name, so it cannot observe an authored name that aliasing would
 * later change.
 *
 * Returns on the FIRST failure. Nothing has been written at this point, so
 * there is nothing to unwind — the caller does not even hold a journal yet.
 */
export async function resolveAll(args: ResolveAllArgs): Promise<ResolveAllResult> {
  const { desiredFacets, previousLockfile, adapters, signal, onStage, onLog } = args

  const resolved: ResolvedFacetRecord[] = []

  const facetNames = Object.keys(desiredFacets).sort(compareCodeUnits)

  for (const facetName of facetNames) {
    const desired = ownEntry(desiredFacets, facetName)
    if (desired === undefined) continue
    const specifier = desired.source
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

    const facetResolution = resolveResult.value

    // Pre-materialization reconciliation (design D10): the previously-locked
    // entry MUST agree with the freshly derived plan before any adapter
    // write. It lives here rather than in the materialize pass because it is
    // a check against the content that just produced the plan — running it
    // any later would only widen the window in which a divergent artifact is
    // treated as trustworthy.
    //
    // It runs unconditionally. Gating it on how content was obtained made
    // frozen reproduction verify a warm cache less strictly than a cold one.
    const previousEntry = ownEntry(previousLockfile.facets, facetName)
    const mismatch = reconcileLockedAgainstPlan(
      facetName,
      previousEntry,
      facetResolution.integrity,
      facetResolution.plan,
    )
    if (mismatch !== undefined) {
      onStage({ kind: 'facet-failure', facet: facetName, failure: mismatch })
      return { ok: false, failure: mismatch }
    }

    resolved.push({ ...facetResolution, facet: facetName, previousEntry })
  }

  return { ok: true, value: { resolved } }
}
