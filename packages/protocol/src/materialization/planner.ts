import type { AssetType, Scope } from '@agent-facets/common'
import { validateAssetNameSegment } from '../schemas/asset-name.ts'
import type {
  MaterializationDisposition,
  MaterializedDisposition,
  ProjectAssetOverride,
} from '../schemas/materialization.ts'
import type { FacetMaterializationOverrides } from '../schemas/project-manifest.ts'
import {
  ASSET_DIRECTORY,
  ASSET_TYPES,
  adapterKey,
  collisionKey,
  compareAssetTypes,
  portableCollisionKey,
} from './identity.ts'
import { type MaterializationNamespace, materializationNamespace } from './namespace.ts'

/**
 * The materialization planner — the pure, normative rule for turning a set
 * of authored facet contributions plus project overrides into either a
 * collision-free materialization plan or the complete list of collisions
 * blocking one.
 *
 * It is a SINGLE-PASS function, not a fixed-point resolver: overrides are
 * applied once against authored identity, then the resulting effective set
 * is checked once. That is what makes alias swaps legal (A→B and B→A both
 * land) while duplicate alias targets fail, and it is why the result never
 * depends on the order facets were declared in.
 *
 * Two consumers share it, which is why it lives in protocol rather than
 * engine:
 *
 *   - The engine calls it during composition to obtain the plan, and again
 *     as a final defense-in-depth check on whatever an interactive resolver
 *     returned.
 *   - The CLI calls it after every edit in the collision workspace to
 *     recompute live status. A draft is allowed to be temporarily
 *     colliding, so a colliding result is a first-class value carrying
 *     every group — never an error and never a truncated report.
 *
 * Determinism is a contract, not an accident: every output list is sorted,
 * so identical inputs produce identical bytes and reviewable diffs.
 */

/** One authored asset contributed by a facet, before any override applies. */
export interface AuthoredAsset {
  scope: Scope
  type: AssetType
  /** The name the publisher declared. Never an alias. */
  name: string
}

/** One facet's contribution to the desired set, with the project's intent for it. */
export interface FacetContribution {
  /** The facet's identity — its key in the project manifest. */
  facet: string
  assets: readonly AuthoredAsset[]
  /**
   * The project's overrides for this facet, keyed by asset type and then by
   * AUTHORED name. Absence of an entry means authored materialization.
   */
  overrides?: FacetMaterializationOverrides | undefined
}

/** An authored asset and the disposition the project resolved for it. */
export interface PlannedAsset {
  facet: string
  scope: Scope
  type: AssetType
  authoredName: string
  /** All three arms — an omitted asset is still planned, just not written. */
  disposition: MaterializationDisposition
}

/** An asset that will actually be written, under its effective identity. */
export interface MaterializedAsset {
  facet: string
  scope: Scope
  type: AssetType
  /** Anchors content lookup, canonical paths, and integrity. */
  authoredName: string
  /** The name adapters read, write, and delete. */
  effectiveName: string
  disposition: MaterializedDisposition
  /** Precomputed {@link adapterKey} for the effective identity. */
  adapterKey: string
}

/** A collision-free plan over the complete desired set. */
export interface MaterializationPlan {
  /**
   * Every authored asset with its final disposition, including omitted
   * ones. This is the lockfile's view: the resolved asset SET, which must
   * stay comparable against project intent.
   */
  assets: readonly PlannedAsset[]
  /**
   * The effective set actually written. This is the apply phase's view.
   * Guaranteed collision-free: no two members share an effective identity.
   */
  materialized: readonly MaterializedAsset[]
}

/** One claimant of a contested effective name. */
export interface CollisionMember {
  facet: string
  scope: Scope
  type: AssetType
  authoredName: string
  /** The name this asset is claiming, which some other member also claims. */
  effectiveName: string
  /** How this claimant arrived at that name — what the user would revise. */
  disposition: MaterializationDisposition
}

/** Two or more assets claiming one logical identity. */
export interface CollisionGroup {
  scope: Scope
  namespace: MaterializationNamespace
  /**
   * The contested name as its first member spells it. Members may differ in
   * case or Unicode normalization while still colliding, so each member
   * carries its own spelling; this field is for display.
   */
  effectiveName: string
  /** Always two or more, deterministically ordered. */
  members: readonly CollisionMember[]
}

/**
 * An override naming an asset the resolved facet version does not contain.
 *
 * Reported rather than fatal: an override is durable project intent, so it
 * survives a failed operation and is pruned only as part of a successful
 * commit. Frozen installation treats the same report as blocking drift.
 */
export interface StaleOverride {
  facet: string
  type: AssetType
  authoredName: string
  disposition: ProjectAssetOverride
}

/** An override whose alias does not satisfy the asset-name grammar. */
export interface InvalidAlias {
  facet: string
  type: AssetType
  authoredName: string
  alias: string
  /** The specific grammar rule violated, for display next to the input. */
  reason: string
}

/**
 * The planner's result.
 *
 * Stale overrides ride on both the success and collision arms because they
 * are a diagnostic about intent, orthogonal to whether the effective set
 * collides. An invalid alias, by contrast, means the input cannot be
 * interpreted at all, so no plan and no collision report can be produced
 * from it.
 */
export type PlanMaterializationResult =
  | { ok: true; plan: MaterializationPlan; staleOverrides: readonly StaleOverride[] }
  | { ok: false; reason: 'invalid-alias'; problems: readonly InvalidAlias[] }
  | {
      ok: false
      reason: 'collision'
      groups: readonly CollisionGroup[]
      staleOverrides: readonly StaleOverride[]
    }

/** Code-unit string ordering. Deliberately not locale-aware: locale-sensitive
 * collation would make output depend on the machine's environment. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The override map for one asset type, if the facet declared any.
 *
 * Exported because every consumer that reads or rewrites project intent —
 * the planner here, the engine's commit phase, a failure renderer — needs
 * the same type-to-group mapping, and {@link ASSET_DIRECTORY} is its single
 * source of truth. A local `switch` in each of them is one edit away from
 * disagreeing about which field an override lives under.
 */
export function overridesForType(
  overrides: FacetMaterializationOverrides | undefined,
  type: AssetType,
): Record<string, ProjectAssetOverride> | undefined {
  return overrides?.[ASSET_DIRECTORY[type]]
}

/**
 * Plan materialization over the complete desired set.
 *
 * Steps, in order:
 *
 *   1. Order facets and their assets deterministically.
 *   2. Match each override to `(facet, type, authored name)`; validate every
 *      alias; report overrides that match no authored asset as stale.
 *   3. Derive one disposition and one effective name per authored asset.
 *   4. Exclude omitted assets from the effective set.
 *   5. Group the remainder by logical collision key and collect EVERY group
 *      with two or more members — the report is exhaustive, so a user is
 *      never marched through repeated attempts to discover one conflict at
 *      a time.
 *   6. Return a plan only when the effective set is collision-free.
 *
 * Purity note: the input is not mutated, and the result shares no mutable
 * structure with it.
 */
export function planMaterialization(contributions: readonly FacetContribution[]): PlanMaterializationResult {
  // 1. Deterministic ordering. Sorting up front means every downstream list
  //    inherits a stable order without re-sorting, and makes the result
  //    independent of how the caller happened to enumerate facets.
  const orderedFacets = [...contributions].sort((a, b) => compareStrings(a.facet, b.facet))

  const planned: PlannedAsset[] = []
  const materialized: MaterializedAsset[] = []
  const staleOverrides: StaleOverride[] = []
  const invalidAliases: InvalidAlias[] = []

  for (const contribution of orderedFacets) {
    const orderedAssets = [...contribution.assets].sort(
      (a, b) => compareAssetTypes(a.type, b.type) || compareStrings(a.name, b.name),
    )

    // 2/3. Resolve each authored asset's disposition.
    const matchedOverrideKeys = new Set<string>()
    for (const asset of orderedAssets) {
      const override = overridesForType(contribution.overrides, asset.type)?.[asset.name]
      matchedOverrideKeys.add(`${asset.type}\u0000${asset.name}`)

      const disposition: MaterializationDisposition = override ?? { kind: 'authored' }

      if (disposition.kind === 'aliased') {
        const check = validateAssetNameSegment(disposition.as)
        if (!check.ok) {
          invalidAliases.push({
            facet: contribution.facet,
            type: asset.type,
            authoredName: asset.name,
            alias: disposition.as,
            reason: check.reason,
          })
          continue
        }
      }

      planned.push({
        facet: contribution.facet,
        scope: asset.scope,
        type: asset.type,
        authoredName: asset.name,
        disposition,
      })

      // 4. Omitted assets leave the effective set entirely.
      if (disposition.kind === 'omitted') continue

      const effectiveName = disposition.kind === 'aliased' ? disposition.as : asset.name
      materialized.push({
        facet: contribution.facet,
        scope: asset.scope,
        type: asset.type,
        authoredName: asset.name,
        effectiveName,
        disposition,
        adapterKey: adapterKey(asset.scope, asset.type, effectiveName),
      })
    }

    // 2 (cont). An override that matched no authored asset is stale. Ordered
    // by type then authored name so the report is stable.
    for (const type of ASSET_TYPES) {
      const record = overridesForType(contribution.overrides, type)
      if (record === undefined) continue
      for (const authoredName of Object.keys(record).sort(compareStrings)) {
        if (matchedOverrideKeys.has(`${type}\u0000${authoredName}`)) continue
        const disposition = record[authoredName]
        if (disposition === undefined) continue
        staleOverrides.push({ facet: contribution.facet, type, authoredName, disposition })
      }
    }
  }

  // An alias that cannot be interpreted makes the whole draft meaningless —
  // there is no effective set to check for collisions.
  if (invalidAliases.length > 0) {
    return { ok: false, reason: 'invalid-alias', problems: invalidAliases }
  }

  // 5. Group the effective set by logical identity.
  const byCollisionKey = new Map<string, MaterializedAsset[]>()
  for (const asset of materialized) {
    const key = collisionKey(asset.scope, asset.type, asset.effectiveName)
    const existing = byCollisionKey.get(key)
    if (existing) {
      existing.push(asset)
    } else {
      byCollisionKey.set(key, [asset])
    }
  }

  const groups: CollisionGroup[] = []
  for (const claimants of byCollisionKey.values()) {
    if (claimants.length < 2) continue
    const ordered = [...claimants].sort(
      (a, b) =>
        compareStrings(a.facet, b.facet) ||
        compareAssetTypes(a.type, b.type) ||
        compareStrings(a.authoredName, b.authoredName),
    )
    // Projected explicitly rather than passed through: a collision member is
    // a claim under review, not a planned write, so it must not carry the
    // adapter key that only a member surviving into a plan would have.
    const members: CollisionMember[] = ordered.map((a) => ({
      facet: a.facet,
      scope: a.scope,
      type: a.type,
      authoredName: a.authoredName,
      effectiveName: a.effectiveName,
      disposition: a.disposition,
    }))
    const first = ordered[0] as MaterializedAsset
    groups.push({
      scope: first.scope,
      namespace: materializationNamespace(first.type),
      effectiveName: first.effectiveName,
      members,
    })
  }

  if (groups.length > 0) {
    groups.sort(
      (a, b) =>
        compareStrings(a.scope, b.scope) ||
        compareStrings(a.namespace, b.namespace) ||
        compareStrings(portableCollisionKey(a.effectiveName), portableCollisionKey(b.effectiveName)),
    )
    return { ok: false, reason: 'collision', groups, staleOverrides }
  }

  // 6. Collision-free: a plan exists.
  return { ok: true, plan: { assets: planned, materialized }, staleOverrides }
}

/**
 * The manifest asset-group key an override for `type` is declared under —
 * `skills`, `agents`, or `commands`. Exposed so failure renderers can point
 * a user at the exact `facets.json` location to edit without restating the
 * type-to-group mapping.
 */
export function overrideGroupKey(type: AssetType): string {
  return ASSET_DIRECTORY[type]
}
