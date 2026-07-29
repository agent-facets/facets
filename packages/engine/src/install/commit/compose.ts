import type {
  CollisionGroup,
  CurrentLockfileAssetEntry,
  CurrentLockfileFacet,
  FacetContribution,
  FacetMaterializationOverrides,
  MaterializationDisposition,
  MaterializedAsset,
  StaleOverride,
} from '@agent-facets/protocol'
import { planMaterialization } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { ownEntry, ownRecord } from '../own-entry.ts'
import type { RunInstallFailure, StageEvent } from '../types.ts'
import type { ResolvedFacetRecord } from './resolve-all.ts'

/**
 * Compose: turn the complete set of verified authored contributions plus the
 * project's persisted intent into either one collision-free global plan or
 * the complete list of collisions blocking it.
 *
 * This is the ONLY place current lockfile entries are constructed FROM
 * RESOLVED STATE. Resolution deliberately produces no entry and no
 * disposition: a disposition is project intent, resolution has not consulted
 * it, and a provisional `authored` stamped during resolution would be
 * indistinguishable from a real decision once it reached the writer. (The
 * removal-only refinement in `install/remove/refine.ts` also builds entries,
 * but by carrying locked ones forward — it never derives one from a
 * resolution.)
 *
 * Nothing here writes. There is no journal, no adapter call, and no project
 * file touched — enforced by the argument type, which offers none of them.
 */

/** What a collision resolver is shown, and what it may change. */
export interface CollisionResolutionRequest {
  /** Every unresolved group. Never truncated — one pass, not one at a time. */
  groups: readonly CollisionGroup[]
  /**
   * Every authored contribution, so a workspace can offer a choice on any
   * asset — including ones that are not currently colliding but could
   * absorb a name.
   */
  contributions: readonly FacetContribution[]
  /** Overrides naming assets the resolved versions no longer contain. */
  staleOverrides: readonly StaleOverride[]
}

/**
 * A resolver's answer.
 *
 * It returns OVERRIDES, not a winner. A resolver therefore cannot express
 * "facet A wins and B is silently dropped" — the only vocabulary available
 * is the same durable project intent a user could have written by hand.
 */
export type CollisionResolution =
  | { kind: 'resolved'; overrides: Readonly<Record<string, FacetMaterializationOverrides>> }
  | { kind: 'cancelled' }

export type CollisionResolver = (request: CollisionResolutionRequest) => Promise<CollisionResolution>

/** A collision-free global plan. */
export interface ComposedPlan {
  /** Current lockfile entries with dispositions applied, keyed by facet. */
  facetEntries: Record<string, CurrentLockfileFacet>
  /**
   * The effective set actually written, guaranteed free of effective-name
   * collisions. Carries each asset's authored name (for content and
   * integrity) alongside its effective name and adapter key (for placement).
   */
  materialized: readonly MaterializedAsset[]
  /** The overrides to persist: those loaded, or those a resolver chose. */
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>
  /**
   * Overrides naming assets absent from the resolved facet versions.
   * Reported, never fatal: an override is durable project intent, so it
   * survives a failed operation and is pruned only by a successful commit.
   */
  staleOverrides: readonly StaleOverride[]
}

export type ComposeResult = { ok: true; plan: ComposedPlan } | { ok: false; failure: RunInstallFailure }

export interface ComposeArgs {
  /** Every desired facet, already resolved and verified. */
  resolved: readonly ResolvedFacetRecord[]
  /** The desired manifest entries, carrying each facet's persisted overrides. */
  desiredFacets: Readonly<Record<string, NormalizedFacetEntry>>
  /**
   * Frozen mode never prompts and never rewrites intent, so a collision is
   * reported rather than resolved even when a resolver is available.
   */
  frozenLockfile: boolean
  /**
   * Interactive resolver. Absent for non-interactive commands, which fail
   * with every group rather than guessing.
   */
  resolveCollisions?: CollisionResolver
  onStage: (event: StageEvent) => void
}

/** The contributions the planner reasons over, in resolve-all's order. */
function contributionsOf(args: ComposeArgs): FacetContribution[] {
  return args.resolved.map((record) => ({
    facet: record.facet,
    assets: record.plan.assets.map((asset) => ({
      scope: asset.scope,
      type: asset.type,
      name: asset.name,
    })),
    overrides: ownEntry(args.desiredFacets, record.facet)?.overrides,
  }))
}

/**
 * Attach each authored asset's resolved disposition to its verified file
 * records, producing the current lockfile entry.
 *
 * Omitted assets stay listed with their complete authored file records: the
 * lockfile records the resolved asset SET and must remain comparable against
 * project intent, so dropping them would make an omission indistinguishable
 * from a facet that never published the asset.
 */
function lockfileEntriesFor(
  resolved: readonly ResolvedFacetRecord[],
  dispositions: ReadonlyMap<string, MaterializationDisposition>,
): Record<string, CurrentLockfileFacet> {
  // Null-prototype, like every other facet-keyed map: the key is a name from
  // a user-authored file, and assignment for `__proto__` creates no own key.
  const entries: Record<string, CurrentLockfileFacet> = ownRecord()
  for (const record of resolved) {
    const assets: CurrentLockfileAssetEntry[] = record.plan.assets.map((asset) => ({
      scope: asset.scope,
      type: asset.type,
      name: asset.name,
      materialization: dispositions.get(dispositionKey(record.facet, asset.scope, asset.type, asset.name)) ?? {
        kind: 'authored',
      },
      files: asset.files,
    }))
    entries[record.facet] = {
      source: record.source,
      version: record.version,
      integrity: record.integrity,
      assets,
    }
  }
  return entries
}

function dispositionKey(facet: string, scope: string, type: string, authoredName: string): string {
  return `${facet}\u0000${scope}\u0000${type}\u0000${authoredName}`
}

/**
 * Run the planner over one override set and project its result into the
 * pieces Compose needs. Shared by the initial pass and the post-resolver
 * defense-in-depth pass so the two cannot diverge.
 */
function planWith(
  resolved: readonly ResolvedFacetRecord[],
  contributions: readonly FacetContribution[],
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
):
  | { ok: true; plan: ComposedPlan }
  | { ok: false; reason: 'collision'; groups: readonly CollisionGroup[]; staleOverrides: readonly StaleOverride[] }
  | { ok: false; reason: 'invalid-alias'; problems: readonly { facet: string; alias: string; reason: string }[] } {
  const withOverrides = contributions.map((contribution) => ({
    ...contribution,
    overrides: ownEntry(overrides, contribution.facet),
  }))
  const result = planMaterialization(withOverrides)
  if (!result.ok) {
    if (result.reason === 'invalid-alias') {
      return { ok: false, reason: 'invalid-alias', problems: result.problems }
    }
    return { ok: false, reason: 'collision', groups: result.groups, staleOverrides: result.staleOverrides }
  }

  const dispositions = new Map<string, MaterializationDisposition>()
  for (const planned of result.plan.assets) {
    dispositions.set(
      dispositionKey(planned.facet, planned.scope, planned.type, planned.authoredName),
      planned.disposition,
    )
  }

  return {
    ok: true,
    plan: {
      facetEntries: lockfileEntriesFor(resolved, dispositions),
      materialized: result.plan.materialized,
      overrides,
      staleOverrides: result.staleOverrides,
    },
  }
}

export async function compose(args: ComposeArgs): Promise<ComposeResult> {
  const { resolved, desiredFacets, frozenLockfile, resolveCollisions, onStage } = args

  onStage({ kind: 'collision-check' })

  const contributions = contributionsOf(args)
  // Null-prototype: the keys are facet names from `facets.json`, and this is
  // where the map the resolver later edits and returns is born. A facet named
  // `__proto__` assigned into a plain `{}` would vanish here rather than in
  // the CLI, one hop from where anyone would look for it.
  const loadedOverrides = ownRecord<FacetMaterializationOverrides>()
  for (const [facet, entry] of Object.entries(desiredFacets)) {
    if (entry.overrides !== undefined) loadedOverrides[facet] = entry.overrides
  }

  const first = planWith(resolved, contributions, loadedOverrides)
  if (first.ok) {
    return { ok: true, plan: first.plan }
  }
  if (first.reason === 'invalid-alias') {
    return { ok: false, failure: { code: 'MATERIALIZATION_ALIAS_INVALID', problems: first.problems } }
  }

  // Collisions. Frozen mode reproduces recorded intent and never collects
  // new decisions, so it reports rather than resolves — the same report a
  // non-interactive command gets.
  if (frozenLockfile || resolveCollisions === undefined) {
    return {
      ok: false,
      failure: {
        code: 'MATERIALIZATION_COLLISION',
        groups: first.groups,
        staleOverrides: first.staleOverrides,
      },
    }
  }

  const resolution = await resolveCollisions({
    groups: first.groups,
    contributions,
    staleOverrides: first.staleOverrides,
  })
  if (resolution.kind === 'cancelled') {
    return { ok: false, failure: { code: 'MATERIALIZATION_CANCELLED' } }
  }

  // Defense in depth: whatever the resolver returned is re-planned through
  // the same pure rule. The resolver is NOT reopened on failure — an
  // automatic retry loop would let a broken resolver spin indefinitely, and
  // the user has already been shown the groups once.
  const second = planWith(resolved, contributions, resolution.overrides)
  if (second.ok) {
    return { ok: true, plan: second.plan }
  }
  return {
    ok: false,
    failure: {
      code: 'MATERIALIZATION_RESOLUTION_INVALID',
      groups: second.reason === 'collision' ? second.groups : [],
      problems: second.reason === 'invalid-alias' ? second.problems : [],
    },
  }
}
