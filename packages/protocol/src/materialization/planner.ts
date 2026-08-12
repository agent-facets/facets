import type { AssetType, Scope } from '@agent-facets/common'
import type {
  MaterializationDisposition,
  MaterializedDisposition,
  ProjectAssetOverride,
} from '../schemas/materialization.ts'
import type { FacetMaterializationOverrides } from '../schemas/project-manifest.ts'
import { type MaterializedName, planEffectiveNames } from './effective-name.ts'
import { ASSET_DIRECTORY, ASSET_TYPE_ORDER, ASSET_TYPES, adapterKey } from './identity.ts'
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
 * Determinism is a contract, not an accident. Facets, assets, collision
 * groups, group members, and stale overrides are all emitted in a total
 * order derived from code-unit string comparison and the canonical
 * asset-type order, so a result depends only on the input SET and never on
 * the order a caller enumerated it in. Byte-level stability of the artifacts
 * downstream is a separate guarantee, owned by the writers that serialize
 * them.
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

/** What a generic name claim carries for the asset domain. */
interface AssetClaim {
  scope: Scope
  type: AssetType
}

/**
 * Separator for the composite identity space. Must match the leading
 * separator {@link collisionKey} uses, so the generic core's identity keys
 * and this domain's published collision keys stay the same strings.
 */
const SPACE_SEPARATOR = '\u0000'

/** The override groups swept for stale asset intent, in canonical order. */
const ASSET_GROUPS: readonly string[] = ASSET_TYPES.map((type) => ASSET_DIRECTORY[type])

/**
 * The asset type an override group belongs to.
 *
 * Total by construction: the only groups handed to the core are the ones
 * derived from {@link ASSET_DIRECTORY} just above, so every group the core
 * can report back has an entry here.
 */
const ASSET_TYPE_BY_GROUP: Readonly<Record<string, AssetType>> = Object.fromEntries(
  ASSET_TYPES.map((type) => [ASSET_DIRECTORY[type], type]),
)

function assetTypeOfGroup(group: string): AssetType {
  return ASSET_TYPE_BY_GROUP[group] as AssetType
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
 * The override declared for one authored asset, if the facet declared one.
 *
 * The own-property check is load-bearing, not defensive style. An override
 * map is an ordinary object, and `constructor` and `__proto__` are perfectly
 * legal asset names, so an indexed read for an asset with either name
 * returns an INHERITED value — `Object`'s constructor function, or
 * `Object.prototype` — where the type promises `ProjectAssetOverride |
 * undefined`. The planner would then store a function as a disposition and
 * emit a plan that looks successful until the field disappears on
 * serialization.
 *
 * Exported so every consumer that reads project intent resolves an override
 * the same way; three call sites had independently open-coded the unsafe
 * indexed read.
 */
export function overrideFor(
  overrides: FacetMaterializationOverrides | undefined,
  type: AssetType,
  authoredName: string,
): ProjectAssetOverride | undefined {
  const record = overridesForType(overrides, type)
  if (record === undefined || !Object.hasOwn(record, authoredName)) return undefined
  return record[authoredName]
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
  const result = planEffectiveNames<AssetClaim>(
    contributions.map((contribution) => ({
      owner: contribution.facet,
      claims: contribution.assets.map((asset) => ({
        owner: contribution.facet,
        group: ASSET_DIRECTORY[asset.type],
        groupOrder: ASSET_TYPE_ORDER[asset.type],
        authoredName: asset.name,
        // Exactly the leading fields of `collisionKey`: a skill and a command
        // share a space, an agent does not, and no two scopes ever do.
        space: [asset.scope, materializationNamespace(asset.type)].join(SPACE_SEPARATOR),
        value: { scope: asset.scope, type: asset.type },
      })),
      overrides: contribution.overrides,
    })),
    {
      groups: ASSET_GROUPS,
      // Text assets never compose: two claims on one effective identity are
      // two files with one path, so any duplicate is a collision.
      contested: (members) => members.length > 1,
    },
  )

  if (!result.ok && result.reason === 'invalid-alias') {
    return {
      ok: false,
      reason: 'invalid-alias',
      problems: result.problems.map((problem) => ({
        facet: problem.owner,
        type: assetTypeOfGroup(problem.group),
        authoredName: problem.authoredName,
        alias: problem.alias,
        reason: problem.reason,
      })),
    }
  }

  const staleOverrides: StaleOverride[] = result.stale.map((entry) => ({
    facet: entry.owner,
    type: assetTypeOfGroup(entry.group),
    authoredName: entry.authoredName,
    disposition: entry.disposition,
  }))

  if (!result.ok) {
    return {
      ok: false,
      reason: 'collision',
      groups: result.groups.map((group) => {
        const first = group.members[0] as MaterializedName<AssetClaim>
        return {
          scope: first.claim.value.scope,
          namespace: materializationNamespace(first.claim.value.type),
          effectiveName: group.effectiveName,
          // Projected explicitly rather than passed through: a collision
          // member is a claim under review, not a planned write, so it must
          // not carry the adapter key only a surviving member would have.
          members: group.members.map((member) => ({
            facet: member.claim.owner,
            scope: member.claim.value.scope,
            type: member.claim.value.type,
            authoredName: member.claim.authoredName,
            effectiveName: member.effectiveName,
            disposition: member.disposition,
          })),
        }
      }),
      staleOverrides,
    }
  }

  const assets: PlannedAsset[] = result.planned.map((entry) => ({
    facet: entry.claim.owner,
    scope: entry.claim.value.scope,
    type: entry.claim.value.type,
    authoredName: entry.claim.authoredName,
    disposition: entry.disposition,
  }))

  const materialized: MaterializedAsset[] = result.materialized.map((entry) => ({
    facet: entry.claim.owner,
    scope: entry.claim.value.scope,
    type: entry.claim.value.type,
    authoredName: entry.claim.authoredName,
    effectiveName: entry.effectiveName,
    disposition: entry.disposition,
    adapterKey: adapterKey(entry.claim.value.scope, entry.claim.value.type, entry.effectiveName),
  }))

  return { ok: true, plan: { assets, materialized }, staleOverrides }
}

/**
 * The manifest asset-group key an override for `type` is declared under —
 * `skills`, `agents`, or `commands`. Exposed so failure renderers can point
 * a user at the exact `facets.json` location to edit without restating the
 * type-to-group mapping.
 *
 * The literal return type is load-bearing: callers that BUILD an override
 * map (rather than just printing a location) index
 * {@link FacetMaterializationOverrides} with it, and a widened `string`
 * would force those call sites into a cast that the type system could no
 * longer check against the schema.
 */
export function overrideGroupKey(type: AssetType): (typeof ASSET_DIRECTORY)[AssetType] {
  return ASSET_DIRECTORY[type]
}
