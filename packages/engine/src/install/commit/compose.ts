import type {
  CollisionGroup,
  CurrentLockfileAssetEntry,
  CurrentLockfileFacet,
  FacetContribution,
  FacetMaterializationOverrides,
  MaterializationDisposition,
  MaterializedAsset,
  PlannedServer,
  PlannedServerConfiguration,
  ServerContribution,
  StaleOverride,
  StaleServerOverride,
} from '@agent-facets/protocol'
import { planMaterialization, planServerMaterialization } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { ownEntry, ownRecord } from '../own-entry.ts'
import type {
  MaterializationCollisionGroup,
  RunInstallFailure,
  StageEvent,
  StaleMaterializationOverride,
} from '../types.ts'
import type { ResolvedFacetRecord } from './resolve-all.ts'

/** Tag an asset-planner stale override for the cross-domain report. */
function taggedAssetStale(stale: StaleOverride): StaleMaterializationOverride {
  return {
    facet: stale.facet,
    contribution: { kind: 'asset', assetType: stale.type },
    authoredName: stale.authoredName,
    disposition: stale.disposition,
  }
}

/** Tag a server-planner stale override for the cross-domain report. */
function taggedServerStale(stale: StaleServerOverride): StaleMaterializationOverride {
  return {
    facet: stale.facet,
    contribution: { kind: 'mcp-server' },
    authoredName: stale.authoredName,
    disposition: stale.disposition,
  }
}

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
  staleOverrides: readonly StaleMaterializationOverride[]
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

/**
 * The MCP half of a collision-free plan.
 *
 * Kept beside the asset half rather than folded into it. The two domains
 * share one planning rule and one override document, but nothing else: a
 * server contributes no lockfile entry, occupies its own identity space, and
 * composes rather than contests when two facets declare it identically.
 * Merging them would mean widening `MaterializedAsset` — and therefore
 * `AssetType` — to describe something that is not an asset.
 */
export interface ComposedMcpServers {
  /**
   * Every authored declaration with its resolved disposition, INCLUDING
   * omitted ones. Reporting needs to say "omitted" about a server, which is
   * unanswerable from the active set alone.
   */
  planned: readonly PlannedServer[]
  /**
   * The active effective configurations to reconcile, one per identity, each
   * carrying every facet that claims it.
   */
  configurations: readonly PlannedServerConfiguration[]
}

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
  /** The MCP configurations to reconcile, planned in their own identity space. */
  mcpServers: ComposedMcpServers
  /** The overrides to persist: those loaded, or those a resolver chose. */
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>
  /**
   * Overrides naming assets or servers absent from the resolved facet
   * versions. Reported, never fatal: an override is durable project intent,
   * so it survives a failed operation and is pruned only by a successful
   * commit.
   */
  staleOverrides: readonly StaleMaterializationOverride[]
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
 * The server contributions, in the same order.
 *
 * Every facet appears, including one that declares nothing: the planner's
 * stale sweep is driven by the override map, so a facet whose only server
 * override names a declaration it no longer publishes has to be visible here
 * for that override to be reported at all.
 */
function serverContributionsOf(args: ComposeArgs): ServerContribution[] {
  return args.resolved.map((record) => ({
    facet: record.facet,
    servers: record.servers,
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
  serverContributions: readonly ServerContribution[],
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
):
  | { ok: true; plan: ComposedPlan }
  | {
      ok: false
      reason: 'collision'
      groups: readonly MaterializationCollisionGroup[]
      staleOverrides: readonly StaleMaterializationOverride[]
    }
  | { ok: false; reason: 'invalid-alias'; problems: readonly { facet: string; alias: string; reason: string }[] } {
  const withOverrides = contributions.map((contribution) => ({
    ...contribution,
    overrides: ownEntry(overrides, contribution.facet),
  }))
  const serversWithOverrides = serverContributions.map((contribution) => ({
    ...contribution,
    overrides: ownEntry(overrides, contribution.facet),
  }))

  // Both domains are planned from the SAME override map, in separate identity
  // spaces. Planning them independently is what makes a skill and a server
  // sharing a name structurally incapable of contending — there is no shared
  // key they could collide in.
  const assets = planMaterialization(withOverrides)
  const servers = planServerMaterialization(serversWithOverrides)

  // Invalid aliases first, and from both domains: an alias that does not
  // satisfy the grammar is a problem with what the user wrote, and reporting
  // a collision instead would send them looking for a conflict that is really
  // a typo.
  const aliasProblems = [
    ...(!assets.ok && assets.reason === 'invalid-alias' ? assets.problems : []),
    ...(!servers.ok && servers.reason === 'invalid-alias'
      ? servers.problems.map((p) => ({ facet: p.facet, alias: p.alias, reason: p.reason }))
      : []),
  ]
  if (aliasProblems.length > 0) {
    return { ok: false, reason: 'invalid-alias', problems: aliasProblems }
  }

  // A stale override is reported from whichever domain still planned, so a
  // collision in one does not suppress the other's diagnostics.
  const staleOverrides: StaleMaterializationOverride[] = [
    ...(assets.ok || assets.reason === 'collision' ? assets.staleOverrides.map(taggedAssetStale) : []),
    ...(!servers.ok && servers.reason === 'invalid-alias' ? [] : servers.staleOverrides.map(taggedServerStale)),
  ]

  if (!assets.ok || !servers.ok) {
    // Every group from both domains, in one report. A user shown asset
    // collisions now and server collisions on the next attempt learns the
    // shape of the problem one round trip at a time.
    const groups: MaterializationCollisionGroup[] = [
      ...(!assets.ok && assets.reason === 'collision'
        ? assets.groups.map((group) => ({ kind: 'asset' as const, group }))
        : []),
      ...(!servers.ok && servers.reason === 'collision'
        ? servers.groups.map((group) => ({ kind: 'mcp-server' as const, group }))
        : []),
    ]
    return { ok: false, reason: 'collision', groups, staleOverrides }
  }

  const dispositions = new Map<string, MaterializationDisposition>()
  for (const planned of assets.plan.assets) {
    dispositions.set(
      dispositionKey(planned.facet, planned.scope, planned.type, planned.authoredName),
      planned.disposition,
    )
  }

  return {
    ok: true,
    plan: {
      facetEntries: lockfileEntriesFor(resolved, dispositions),
      materialized: assets.plan.materialized,
      mcpServers: { planned: servers.planned, configurations: servers.configurations },
      overrides,
      staleOverrides,
    },
  }
}

export async function compose(args: ComposeArgs): Promise<ComposeResult> {
  const { resolved, desiredFacets, frozenLockfile, resolveCollisions, onStage } = args

  onStage({ kind: 'collision-check' })

  const contributions = contributionsOf(args)
  const serverContributions = serverContributionsOf(args)
  // Null-prototype: the keys are facet names from `facets.json`, and this is
  // where the map the resolver later edits and returns is born. A facet named
  // `__proto__` assigned into a plain `{}` would vanish here rather than in
  // the CLI, one hop from where anyone would look for it.
  const loadedOverrides = ownRecord<FacetMaterializationOverrides>()
  for (const [facet, entry] of Object.entries(desiredFacets)) {
    if (entry.overrides !== undefined) loadedOverrides[facet] = entry.overrides
  }

  const first = planWith(resolved, contributions, serverContributions, loadedOverrides)
  if (first.ok) {
    return { ok: true, plan: first.plan }
  }
  if (first.reason === 'invalid-alias') {
    return { ok: false, failure: { code: 'MATERIALIZATION_ALIAS_INVALID', problems: first.problems } }
  }

  const assetGroups = first.groups.flatMap((entry) => (entry.kind === 'asset' ? [entry.group] : []))
  const collisionFailure: RunInstallFailure = {
    code: 'MATERIALIZATION_COLLISION',
    groups: first.groups,
    staleOverrides: first.staleOverrides,
  }

  // Collisions. Frozen mode reproduces recorded intent and never collects new
  // decisions, so it reports rather than resolves — the same report a
  // non-interactive command gets.
  //
  // A server collision also reports rather than resolves, for now: the
  // resolution workspace speaks only about assets, so handing it a set whose
  // server half it cannot express would let a user confirm a draft that
  // resolves nothing and fail on the re-plan. Reporting is the honest answer
  // until the workspace can offer a choice for every claimant.
  if (frozenLockfile || resolveCollisions === undefined || assetGroups.length !== first.groups.length) {
    return { ok: false, failure: collisionFailure }
  }

  const resolution = await resolveCollisions({
    groups: assetGroups,
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
  const second = planWith(resolved, contributions, serverContributions, resolution.overrides)
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
