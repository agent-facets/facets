import type { AssetType } from '@agent-facets/common'
import type {
  AuthoredAsset,
  AuthoredServer,
  FacetMaterializationOverrides,
  MaterializationOverrideGroup,
  MaterializationPlan,
  PlannedServer,
  PlannedServerConfiguration,
} from '@agent-facets/protocol'
import {
  overrideGroupKey,
  planMaterialization,
  planServerMaterialization,
  SERVER_OVERRIDE_GROUP,
} from '@agent-facets/protocol'
import { ownEntry } from '../own-entry.ts'
import type { ContributionKind, MaterializationCollisionGroup, StaleMaterializationOverride } from '../types.ts'

/**
 * The one cross-domain naming rule: given the complete desired set and one
 * override document, what does the project materialize?
 *
 * Shared deliberately. The engine runs it to compose a plan and again to
 * validate whatever an interactive resolver hands back; the CLI's collision
 * workspace runs it after every edit to decide whether Confirm is legal. Two
 * implementations of "does this draft plan cleanly?" is one implementation
 * away from a green confirm button that fails the install a second later.
 *
 * Both domains are planned from the SAME override map, in separate identity
 * spaces. That separation is what makes a skill named `review` and a server
 * named `review` structurally incapable of contending — there is no shared
 * key they could collide in — and it is a property of calling two planners,
 * not of a check anyone has to remember to write.
 */

/**
 * One facet's complete authored contribution.
 *
 * Assets and servers travel together, keyed by facet, because they are
 * planned against one override document. Carrying that document per facet
 * here as well would be a second place to say the same thing — and the one
 * the planner ignores, since intent arrives as a separate map that a draft
 * can replace wholesale.
 */
export interface CollisionFacetContribution {
  facet: string
  assets: readonly AuthoredAsset[]
  servers: readonly AuthoredServer[]
}

/**
 * An override whose alias is not a legal name.
 *
 * Tagged, and carrying exactly what the override document is keyed by:
 * facet, group, authored name. Deliberately NO scope — an override lives at
 * `materialization.skills["review"]`, which names no scope, so a scope here
 * would be a field with nothing to fill it from and a renderer free to print
 * a guess.
 */
export type MaterializationAliasProblem =
  | { kind: 'asset'; facet: string; assetType: AssetType; authoredName: string; alias: string; reason: string }
  | { kind: 'mcp-server'; facet: string; authoredName: string; alias: string; reason: string }

/**
 * What one override document plans to.
 *
 * The three arms mirror both planners': an invalid alias means the input
 * cannot be interpreted at all, so no plan and no collision report exist for
 * it, while a collision still carries the stale-override diagnostics that are
 * orthogonal to it.
 */
export type CollisionPlanResult =
  | {
      ok: true
      assets: MaterializationPlan
      servers: { planned: readonly PlannedServer[]; configurations: readonly PlannedServerConfiguration[] }
      staleOverrides: readonly StaleMaterializationOverride[]
    }
  | {
      ok: false
      reason: 'collision'
      groups: readonly MaterializationCollisionGroup[]
      staleOverrides: readonly StaleMaterializationOverride[]
    }
  | { ok: false; reason: 'invalid-alias'; problems: readonly MaterializationAliasProblem[] }

/** Plan the complete desired set against one override document. */
export function planCollisionIntent(
  facets: readonly CollisionFacetContribution[],
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
): CollisionPlanResult {
  // Own-property reads throughout: facet names come from `facets.json`, where
  // `constructor` is a legal key that would otherwise resolve to `Object`.
  const assets = planMaterialization(
    facets.map((contribution) => ({
      facet: contribution.facet,
      assets: contribution.assets,
      overrides: ownEntry(overrides, contribution.facet),
    })),
  )
  const servers = planServerMaterialization(
    facets.map((contribution) => ({
      facet: contribution.facet,
      servers: contribution.servers,
      overrides: ownEntry(overrides, contribution.facet),
    })),
  )

  // Invalid aliases first, and from both domains: an alias that does not
  // satisfy the grammar is a problem with what the user wrote, and reporting a
  // collision instead would send them looking for a conflict that is really a
  // typo.
  const problems: MaterializationAliasProblem[] = [
    ...(!assets.ok && assets.reason === 'invalid-alias'
      ? assets.problems.map(
          (problem): MaterializationAliasProblem => ({
            kind: 'asset',
            facet: problem.facet,
            assetType: problem.type,
            authoredName: problem.authoredName,
            alias: problem.alias,
            reason: problem.reason,
          }),
        )
      : []),
    ...(!servers.ok && servers.reason === 'invalid-alias'
      ? servers.problems.map(
          (problem): MaterializationAliasProblem => ({
            kind: 'mcp-server',
            facet: problem.facet,
            authoredName: problem.authoredName,
            alias: problem.alias,
            reason: problem.reason,
          }),
        )
      : []),
  ]
  if (problems.length > 0) return { ok: false, reason: 'invalid-alias', problems }

  // A stale override is reported from whichever domain still planned, so a
  // collision in one does not suppress the other's diagnostics.
  const staleOverrides: StaleMaterializationOverride[] = [
    ...(assets.ok || assets.reason === 'collision'
      ? assets.staleOverrides.map(
          (stale): StaleMaterializationOverride => ({
            facet: stale.facet,
            contribution: { kind: 'asset', assetType: stale.type },
            authoredName: stale.authoredName,
            disposition: stale.disposition,
          }),
        )
      : []),
    ...(servers.ok || servers.reason === 'collision'
      ? servers.staleOverrides.map(
          (stale): StaleMaterializationOverride => ({
            facet: stale.facet,
            contribution: { kind: 'mcp-server' },
            authoredName: stale.authoredName,
            disposition: stale.disposition,
          }),
        )
      : []),
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

  return {
    ok: true,
    assets: assets.plan,
    servers: { planned: servers.planned, configurations: servers.configurations },
    staleOverrides,
  }
}

/**
 * The `facets.json` group one contribution kind's overrides live under.
 *
 * The single mapping, exported because four surfaces need it: the prune pass,
 * the collision draft's read and write paths, and the failure renderer that
 * tells a user where to type. `overrideGroupKey` alone cannot serve — its
 * return type is the three asset directories, and cannot express `servers`.
 */
export function overrideGroupFor(contribution: ContributionKind): MaterializationOverrideGroup {
  switch (contribution.kind) {
    case 'asset':
      return overrideGroupKey(contribution.assetType)
    case 'mcp-server':
      return SERVER_OVERRIDE_GROUP
  }
}
