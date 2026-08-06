import { compareCodeUnits } from '../ordering.ts'
import { validateAssetNameSegment } from '../schemas/asset-name.ts'
import type {
  MaterializationDisposition,
  MaterializedDisposition,
  ProjectAssetOverride,
} from '../schemas/materialization.ts'
import { cloneDisposition } from '../schemas/materialization.ts'
import { portableCollisionKey } from './identity.ts'

/**
 * The domain-neutral effective-name planning rule.
 *
 * Text assets and MCP server configurations answer the same question — given
 * a set of authored claims plus a project's aliases and omissions, what is
 * the effective set, and what contests? — but they are NOT the same domain.
 * Servers are deliberately not an `AssetType`: they occupy their own
 * identity space, live under their own override group, and compose by a
 * different rule (identical declarations merge; assets never merge). Keeping
 * one algorithm behind two typed wrappers is what stops those differences
 * from turning into two implementations that drift on the parts that were
 * never meant to differ: the ordering contract, the single-pass alias
 * semantics, the invalid-alias-preempts-contest rule, the stale-override
 * sweep, and the disposition-cloning discipline.
 *
 * Everything here is parameterized by DATA — a claim carries its own group,
 * order, and identity space — with exactly one behavioral parameter,
 * `contested`. One auditable injection point rather than five keeps the
 * "pure, single-pass, deterministic" contract verifiable by reading this
 * file.
 *
 * The pass is single, not fixed-point: overrides apply once against
 * authored identity, then the resulting effective set is checked once. That
 * is what makes alias swaps (A→B, B→A) legal while duplicate alias targets
 * contest, and why the result depends only on the input SET.
 */

/**
 * One authored name claim, stripped of domain meaning.
 *
 * `value` is echoed back untouched so a wrapper re-projects its own domain
 * type without building a lookup index. The core never inspects it, and
 * never clones it — wrappers construct fresh `value` records at the call
 * site so the result shares no mutable structure with the caller's input.
 */
export interface NameClaim<T> {
  /** The contributing facet. Outer sort key, reported on every arm. */
  owner: string
  /** The override group this claim's disposition is read from and written to. */
  group: string
  /** Total order among groups, applied before authored name. */
  groupOrder: number
  /** The name the publisher declared. Never an alias. */
  authoredName: string
  /**
   * Opaque identity space. Two claims may contest only when their spaces are
   * equal, so separate spaces make cross-domain contention structurally
   * impossible rather than merely unlikely.
   */
  space: string
  value: T
}

/** Override maps for one facet, keyed by group and then by AUTHORED name. */
export type OverrideGroups = {
  readonly [group: string]: Readonly<Record<string, ProjectAssetOverride>> | undefined
}

/** One facet's claims plus the project's recorded intent for them. */
export interface NameContribution<T> {
  owner: string
  claims: readonly NameClaim<T>[]
  overrides?: OverrideGroups | undefined
}

/** A claim and the disposition the project resolved for it, including omissions. */
export interface PlannedName<T> {
  claim: NameClaim<T>
  disposition: MaterializationDisposition
}

/** A claim that survives into the effective set, under its effective name. */
export interface MaterializedName<T> {
  claim: NameClaim<T>
  effectiveName: string
  disposition: MaterializedDisposition
}

/**
 * Every claim resolving to one effective identity.
 *
 * Emitted on success (where a group may be a single uncontested claim, or
 * several claims a domain considers equivalent) and on the contested arm
 * (where it is the complete list of claimants blocking a plan).
 */
export interface NameGroup<T> {
  space: string
  /**
   * The identity as its first member spells it. Members may differ by case
   * or Unicode normalization while still sharing an identity, so each member
   * carries its own spelling; this field is for display.
   */
  effectiveName: string
  members: readonly MaterializedName<T>[]
}

/** An override naming something the resolved facet does not contain. */
export interface StaleName {
  owner: string
  group: string
  authoredName: string
  disposition: ProjectAssetOverride
}

/** An override whose alias does not satisfy the portable name grammar. */
export interface InvalidAliasName {
  owner: string
  group: string
  authoredName: string
  alias: string
  reason: string
}

/**
 * The core's result.
 *
 * Stale overrides ride on both the success and contested arms because they
 * are a diagnostic about intent, orthogonal to whether the effective set
 * contests. An invalid alias means the input cannot be interpreted at all,
 * so neither a plan nor a contest report can be derived from it.
 */
export type PlanEffectiveNamesResult<T> =
  | {
      ok: true
      /** Every claim with its final disposition, including omitted ones. */
      planned: readonly PlannedName<T>[]
      /**
       * The effective set in claim order. Flat and 1:1 with the claims that
       * survived, which is what ownership diffing and the apply loop consume.
       */
      materialized: readonly MaterializedName<T>[]
      /**
       * The same effective set grouped by identity. Domains that compose
       * several claims into one artifact consume this instead.
       */
      identities: readonly NameGroup<T>[]
      stale: readonly StaleName[]
    }
  | { ok: false; reason: 'invalid-alias'; problems: readonly InvalidAliasName[] }
  | { ok: false; reason: 'contested'; groups: readonly NameGroup<T>[]; stale: readonly StaleName[] }

/** Field separator for composite keys. NUL cannot appear in a validated field. */
const KEY_SEPARATOR = '\u0000'

/**
 * The override declared for one authored name, if the facet declared one.
 *
 * The own-property check is load-bearing, not defensive style. An override
 * map is an ordinary object, and `constructor` and `__proto__` are legal
 * authored names, so an indexed read for either returns an INHERITED value —
 * `Object`'s constructor function, or `Object.prototype` — where the type
 * promises `ProjectAssetOverride | undefined`. The plan would then carry a
 * function as a disposition and look successful until the field disappeared
 * on serialization.
 *
 * The group-level read is a direct index because group names come from a
 * closed set the caller controls, never from a document.
 */
function overrideIn(
  overrides: OverrideGroups | undefined,
  group: string,
  authoredName: string,
): ProjectAssetOverride | undefined {
  const record = overrides?.[group]
  if (record === undefined || !Object.hasOwn(record, authoredName)) return undefined
  return record[authoredName]
}

/**
 * Plan effective names over the complete desired set.
 *
 * `groups` is the ordered list of override group names to sweep for stale
 * intent. `contested` decides whether a set of claims sharing one identity
 * is a conflict — assets always contest, while a domain whose claims can be
 * proven equivalent may compose them instead. It must be pure and total.
 */
export function planEffectiveNames<T>(
  contributions: readonly NameContribution<T>[],
  options: {
    readonly groups: readonly string[]
    contested(members: readonly MaterializedName<T>[]): boolean
  },
): PlanEffectiveNamesResult<T> {
  // 1. Deterministic ordering. Sorting up front means every downstream list
  //    inherits a stable order without re-sorting, and makes the result
  //    independent of how the caller enumerated facets.
  const orderedOwners = [...contributions].sort((a, b) => compareCodeUnits(a.owner, b.owner))

  const planned: PlannedName<T>[] = []
  const materialized: MaterializedName<T>[] = []
  const stale: StaleName[] = []
  const invalidAliases: InvalidAliasName[] = []

  for (const contribution of orderedOwners) {
    const orderedClaims = [...contribution.claims].sort(
      (a, b) => a.groupOrder - b.groupOrder || compareCodeUnits(a.authoredName, b.authoredName),
    )

    // 2/3. Resolve each claim's disposition.
    const matchedOverrideKeys = new Set<string>()
    for (const claim of orderedClaims) {
      const override = overrideIn(contribution.overrides, claim.group, claim.authoredName)
      // Recorded before the alias check so an override that matched a claim
      // is never ALSO reported stale just because its alias was rejected.
      matchedOverrideKeys.add(`${claim.group}${KEY_SEPARATOR}${claim.authoredName}`)

      const disposition: MaterializationDisposition = override ?? { kind: 'authored' }

      if (disposition.kind === 'aliased') {
        const check = validateAssetNameSegment(disposition.as)
        if (!check.ok) {
          invalidAliases.push({
            owner: contribution.owner,
            group: claim.group,
            authoredName: claim.authoredName,
            alias: disposition.as,
            reason: check.reason,
          })
          continue
        }
      }

      // Cloned per output collection, not once: the caller's override object
      // must not be reachable from the result, and the planned and
      // materialized lists must not alias each other either.
      planned.push({ claim, disposition: cloneDisposition(disposition) })

      // 4. Omitted claims leave the effective set entirely.
      if (disposition.kind === 'omitted') continue

      materialized.push({
        claim,
        effectiveName: disposition.kind === 'aliased' ? disposition.as : claim.authoredName,
        disposition: cloneDisposition(disposition),
      })
    }

    // 2 (cont). An override matching no claim is stale. Ordered by group then
    // authored name so the report is stable.
    for (const group of options.groups) {
      const record = contribution.overrides?.[group]
      if (record === undefined) continue
      for (const authoredName of Object.keys(record).sort(compareCodeUnits)) {
        if (matchedOverrideKeys.has(`${group}${KEY_SEPARATOR}${authoredName}`)) continue
        const disposition = overrideIn(contribution.overrides, group, authoredName)
        if (disposition === undefined) continue
        stale.push({
          owner: contribution.owner,
          group,
          authoredName,
          disposition: cloneDisposition(disposition),
        })
      }
    }
  }

  // An alias that cannot be interpreted makes the whole draft meaningless —
  // there is no effective set to check.
  if (invalidAliases.length > 0) {
    return { ok: false, reason: 'invalid-alias', problems: invalidAliases }
  }

  // 5. Group the effective set by logical identity.
  const byIdentity = new Map<string, MaterializedName<T>[]>()
  for (const entry of materialized) {
    const key = `${entry.claim.space}${KEY_SEPARATOR}${portableCollisionKey(entry.effectiveName)}`
    const existing = byIdentity.get(key)
    if (existing) {
      existing.push(entry)
    } else {
      byIdentity.set(key, [entry])
    }
  }

  const identities: NameGroup<T>[] = []
  const contestedGroups: NameGroup<T>[] = []
  for (const claimants of byIdentity.values()) {
    const ordered = [...claimants].sort(
      (a, b) =>
        compareCodeUnits(a.claim.owner, b.claim.owner) ||
        a.claim.groupOrder - b.claim.groupOrder ||
        compareCodeUnits(a.claim.authoredName, b.claim.authoredName),
    )
    const first = ordered[0] as MaterializedName<T>
    const group: NameGroup<T> = {
      space: first.claim.space,
      effectiveName: first.effectiveName,
      members: ordered.map((entry) => ({
        claim: entry.claim,
        effectiveName: entry.effectiveName,
        disposition: cloneDisposition(entry.disposition),
      })),
    }
    if (options.contested(ordered)) {
      contestedGroups.push(group)
    } else {
      identities.push(group)
    }
  }

  const byIdentityOrder = (a: NameGroup<T>, b: NameGroup<T>): number =>
    compareCodeUnits(a.space, b.space) ||
    compareCodeUnits(portableCollisionKey(a.effectiveName), portableCollisionKey(b.effectiveName))

  if (contestedGroups.length > 0) {
    contestedGroups.sort(byIdentityOrder)
    return { ok: false, reason: 'contested', groups: contestedGroups, stale }
  }

  identities.sort(byIdentityOrder)

  // 6. Contest-free: a plan exists.
  return { ok: true, planned, materialized, identities, stale }
}
