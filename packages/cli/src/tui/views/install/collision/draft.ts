import type { AssetType, Scope } from '@agent-facets/common'
import type { CollisionResolutionRequest } from '@agent-facets/engine'
import type {
  CollisionGroup,
  FacetMaterializationOverrides,
  MaterializationDisposition,
  StaleOverride,
} from '@agent-facets/protocol'
import {
  isMaterialized,
  materializedNameOf,
  overrideGroupKey,
  planMaterialization,
  validateAssetNameSegment,
} from '@agent-facets/protocol'
import type { CollisionStatus } from '../collision-status.ts'

/**
 * The collision workspace's state, and the pure rule that turns it into
 * something renderable.
 *
 * Two properties drive the whole design:
 *
 *  1. **There is exactly one draft, and it is the same shape the engine
 *     consumes.** The draft IS a `Record<facet, overrides>` — the same
 *     durable project intent a user could have typed into `facets.json`.
 *     There is no parallel "UI choice" model to keep in sync, so the
 *     thing shown and the thing submitted cannot disagree.
 *
 *  2. **Collision truth comes from the protocol planner, always.** This
 *     module never decides what collides. It arranges the planner's
 *     answer for display. That is what keeps the live preview and the
 *     engine's final validation from ever disagreeing — a disagreement
 *     would show a green confirm button that then fails the install.
 */

/** One asset a facet contributes, addressed by its authored identity. */
export interface ClaimantRef {
  facet: string
  scope: Scope
  type: AssetType
  authoredName: string
}

/**
 * Stable identity for a claimant. NUL-joined because it cannot occur in a
 * facet name, an asset name, or a scope, so no combination of legal
 * values can forge another claimant's key.
 */
export function claimantKey(ref: ClaimantRef): string {
  return `${ref.facet}\u0000${ref.scope}\u0000${ref.type}\u0000${ref.authoredName}`
}

export interface CollisionDraft {
  /**
   * Complete project intent. Handed to the engine verbatim, so facets and
   * assets the workspace never displays keep the overrides they arrived
   * with.
   */
  readonly overrides: Readonly<Record<string, FacetMaterializationOverrides>>
  /**
   * Claimants the user changed in this session. Purely presentational:
   * it separates "this collided when you got here" (unresolved) from
   * "your edits caused this" (draft conflict). It is never submitted.
   */
  readonly edited: ReadonlySet<string>
  /**
   * Every claimant ever surfaced, so the workspace only ever grows.
   *
   * Without this, un-doing an alias would delete the row the user was
   * standing on — the list would reflow under the cursor mid-edit.
   */
  readonly claimants: ReadonlyMap<string, ClaimantRef>
}

/** A claimant as displayed: its current choice, name, and standing. */
export interface ClaimantModel extends ClaimantRef {
  key: string
  disposition: MaterializationDisposition
  /** Empty when omitted — there is no effective name to show. */
  effectiveName: string | null
  status: CollisionStatus
  /** Other claimants contesting this name right now, for navigation. */
  conflictsWith: readonly string[]
  /** Why the current alias is not a legal asset name, if it isn't. */
  aliasError: string | null
}

export interface DisplayGroup {
  key: string
  /** The name(s) that first brought these claimants together. */
  origin: string
  /** Names contested right now. Empty once the group is resolved. */
  contested: readonly string[]
  status: CollisionStatus
  members: readonly ClaimantModel[]
}

export interface WorkspaceModel {
  groups: readonly DisplayGroup[]
  /**
   * Whether the complete draft plans cleanly. This is the planner's
   * verdict, not a count of green rows: the confirm gate and the engine's
   * final check then answer the same question the same way.
   */
  confirmable: boolean
  staleOverrides: readonly StaleOverride[]
}

/** Seed a draft from the overrides the project already has. */
export function createDraft(request: CollisionResolutionRequest): CollisionDraft {
  const overrides: Record<string, FacetMaterializationOverrides> = {}
  for (const contribution of request.contributions) {
    if (contribution.overrides !== undefined) overrides[contribution.facet] = contribution.overrides
  }
  return {
    overrides,
    edited: new Set(),
    claimants: claimantsOf(request.groups),
  }
}

/**
 * Record one Keep / Alias / Omit choice.
 *
 * Keep DELETES the override rather than writing `{ kind: 'authored' }`.
 * Absence already means "use the authored name", and the project schema
 * rejects an explicit `authored` override precisely so the same state
 * cannot be spelled two ways.
 */
export function reviseDraft(
  request: CollisionResolutionRequest,
  draft: CollisionDraft,
  ref: ClaimantRef,
  disposition: MaterializationDisposition,
): CollisionDraft {
  const overrides = withOverride(draft.overrides, ref, disposition)
  const edited = new Set(draft.edited)
  edited.add(claimantKey(ref))

  // An alias can pull in an asset that was never colliding. Surface it
  // immediately: the user has to be able to reach the other side of a
  // conflict they just created.
  const claimants = new Map(draft.claimants)
  const planned = planMaterialization(contributionsWith(request, overrides))
  if (!planned.ok && planned.reason === 'collision') {
    for (const [key, value] of claimantsOf(planned.groups)) {
      if (!claimants.has(key)) claimants.set(key, value)
    }
  }

  return { overrides, edited, claimants }
}

/** Arrange the planner's current verdict for display. */
export function evaluateDraft(request: CollisionResolutionRequest, draft: CollisionDraft): WorkspaceModel {
  const planned = planMaterialization(contributionsWith(request, draft.overrides))

  const currentGroups = !planned.ok && planned.reason === 'collision' ? planned.groups : []

  // Defensive, not expected: the workspace commits an alias only after
  // the same validator accepts it, and the engine rejects an unparseable
  // persisted alias before ever opening a resolver. Kept so that a draft
  // holding a bad alias explains itself instead of showing a green row
  // beside a disabled confirm button.
  const aliasErrors = new Map<string, string>()
  if (!planned.ok && planned.reason === 'invalid-alias') {
    for (const problem of planned.problems) {
      const scope = scopeOf(request, problem.facet, problem.type, problem.authoredName)
      if (scope === null) continue
      aliasErrors.set(
        claimantKey({ facet: problem.facet, scope, type: problem.type, authoredName: problem.authoredName }),
        problem.reason,
      )
    }
  }

  // Which claimants are contesting a name right now, and with whom.
  const conflictsWith = new Map<string, string[]>()
  const contestedNameOf = new Map<string, string>()
  for (const group of currentGroups) {
    const keys = group.members.map((member) => claimantKey(member))
    for (const key of keys) {
      conflictsWith.set(
        key,
        keys.filter((other) => other !== key),
      )
      contestedNameOf.set(key, group.effectiveName)
    }
  }

  const components = groupClaimants(request.groups, currentGroups, draft.claimants)

  const groups: DisplayGroup[] = components.map((component) => {
    const members = component.members
      .map((ref) => modelFor(ref, draft, conflictsWith, aliasErrors))
      .sort(compareClaimants)
    const contested = unique(
      members.flatMap((member) => {
        const name = contestedNameOf.get(member.key)
        return name === undefined ? [] : [name]
      }),
    )
    return {
      key: component.key,
      origin: component.origin.join(', '),
      contested,
      status: worstStatus(members.map((member) => member.status)),
      members,
    }
  })

  return {
    groups,
    confirmable: planned.ok,
    staleOverrides: planned.ok ? planned.staleOverrides : request.staleOverrides,
  }
}

/** The value handed back to the engine. */
export function draftOverrides(draft: CollisionDraft): Readonly<Record<string, FacetMaterializationOverrides>> {
  return draft.overrides
}

/** The current choice for one claimant. */
export function choiceFor(draft: CollisionDraft, ref: ClaimantRef): MaterializationDisposition {
  return overrideFor(draft.overrides, ref) ?? { kind: 'authored' }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function modelFor(
  ref: ClaimantRef,
  draft: CollisionDraft,
  conflictsWith: ReadonlyMap<string, readonly string[]>,
  aliasErrors: ReadonlyMap<string, string>,
): ClaimantModel {
  const key = claimantKey(ref)
  const disposition = choiceFor(draft, ref)
  const conflicts = conflictsWith.get(key) ?? []
  const aliasError = aliasErrors.get(key) ?? null

  return {
    ...ref,
    key,
    disposition,
    effectiveName: isMaterialized(disposition) ? materializedNameOf(ref.authoredName, disposition) : null,
    status: statusFor({ key, conflicts, aliasError, draft, conflictsWith }),
    conflictsWith: conflicts,
    aliasError,
  }
}

/**
 * The three-state rule.
 *
 * The distinction that matters is between a collision the user inherited
 * and one their own edits produced: the first says "you must decide
 * something", the second says "your decision isn't finished". A group
 * counts as edited if ANY of its claimants was touched — otherwise the
 * asset someone else's alias landed on would stay red and read as an
 * unrelated pre-existing problem.
 */
function statusFor(args: {
  key: string
  conflicts: readonly string[]
  aliasError: string | null
  draft: CollisionDraft
  conflictsWith: ReadonlyMap<string, readonly string[]>
}): CollisionStatus {
  const { key, conflicts, aliasError, draft } = args
  // An alias that isn't a legal name blocks confirmation, so it can never
  // read as settled — even though the planner reports no group for it.
  if (aliasError !== null) return 'unresolved'
  if (conflicts.length === 0) return 'resolved'
  const touched = [key, ...conflicts].some((member) => draft.edited.has(member))
  return touched ? 'draft-conflict' : 'unresolved'
}

const STATUS_SEVERITY: Record<CollisionStatus, number> = {
  unresolved: 2,
  'draft-conflict': 1,
  resolved: 0,
}

function worstStatus(statuses: readonly CollisionStatus[]): CollisionStatus {
  let worst: CollisionStatus = 'resolved'
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status
  }
  return worst
}

/**
 * Partition claimants into the groups the user works through.
 *
 * Membership is the transitive closure of "was originally grouped with"
 * and "collides with right now". Union-find rather than a simple index by
 * contested name, because both relations move: aliasing one claimant onto
 * another group's name genuinely merges two problems into one decision,
 * and the user has to see them together to solve either.
 */
function groupClaimants(
  originalGroups: readonly CollisionGroup[],
  currentGroups: readonly CollisionGroup[],
  claimants: ReadonlyMap<string, ClaimantRef>,
): ReadonlyArray<{ key: string; origin: string[]; members: ClaimantRef[] }> {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    let root = key
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root) as string
    return root
  }
  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }

  for (const key of claimants.keys()) parent.set(key, key)

  const originNames = new Map<string, Set<string>>()
  for (const group of [...originalGroups, ...currentGroups]) {
    const keys = group.members.map((member) => claimantKey(member))
    const first = keys[0]
    if (first === undefined) continue
    for (const key of keys) {
      if (!parent.has(key)) parent.set(key, key)
      union(first, key)
    }
  }
  for (const group of originalGroups) {
    const first = group.members[0]
    if (first === undefined) continue
    const root = find(claimantKey(first))
    const names = originNames.get(root) ?? new Set<string>()
    names.add(group.effectiveName)
    originNames.set(root, names)
  }

  const byRoot = new Map<string, ClaimantRef[]>()
  for (const [key, ref] of claimants) {
    const root = find(key)
    const members = byRoot.get(root) ?? []
    members.push(ref)
    byRoot.set(root, members)
  }

  // Origin names were indexed before the final unions settled, so fold
  // them onto the roots that actually survived.
  const foldedOrigins = new Map<string, Set<string>>()
  for (const [root, names] of originNames) {
    const settled = find(root)
    const target = foldedOrigins.get(settled) ?? new Set<string>()
    for (const name of names) target.add(name)
    foldedOrigins.set(settled, target)
  }

  return [...byRoot.entries()]
    .map(([root, members]) => ({
      key: root,
      origin: [...(foldedOrigins.get(root) ?? new Set<string>())].sort(compareStrings),
      members,
    }))
    .sort((a, b) => compareStrings(a.origin.join(', '), b.origin.join(', ')) || compareStrings(a.key, b.key))
}

function claimantsOf(groups: readonly CollisionGroup[]): Map<string, ClaimantRef> {
  const claimants = new Map<string, ClaimantRef>()
  for (const group of groups) {
    for (const member of group.members) {
      const ref: ClaimantRef = {
        facet: member.facet,
        scope: member.scope,
        type: member.type,
        authoredName: member.authoredName,
      }
      claimants.set(claimantKey(ref), ref)
    }
  }
  return claimants
}

function contributionsWith(
  request: CollisionResolutionRequest,
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
) {
  return request.contributions.map((contribution) => ({
    ...contribution,
    overrides: overrides[contribution.facet],
  }))
}

function overrideFor(
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
  ref: ClaimantRef,
): MaterializationDisposition | undefined {
  return overrides[ref.facet]?.[overrideGroupKey(ref.type)]?.[ref.authoredName]
}

function withOverride(
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
  ref: ClaimantRef,
  disposition: MaterializationDisposition,
): Record<string, FacetMaterializationOverrides> {
  const group = overrideGroupKey(ref.type)
  const next: Record<string, FacetMaterializationOverrides> = { ...overrides }
  const facet: FacetMaterializationOverrides = { ...(next[ref.facet] ?? {}) }
  const assets = { ...(facet[group] ?? {}) }

  if (disposition.kind === 'authored') {
    delete assets[ref.authoredName]
  } else {
    assets[ref.authoredName] = disposition
  }

  if (Object.keys(assets).length === 0) delete facet[group]
  else facet[group] = assets

  if (Object.keys(facet).length === 0) delete next[ref.facet]
  else next[ref.facet] = facet

  return next
}

/**
 * Recover a claimant's scope from the authored contributions.
 *
 * `InvalidAlias` carries no scope — it is a complaint about a string, not
 * about a placement — so the scope is looked up rather than assumed.
 * Returns null instead of defaulting: silently guessing `project` would
 * attach the error to a different claimant the day a second scope exists.
 */
function scopeOf(
  request: CollisionResolutionRequest,
  facet: string,
  type: AssetType,
  authoredName: string,
): Scope | null {
  for (const contribution of request.contributions) {
    if (contribution.facet !== facet) continue
    for (const asset of contribution.assets) {
      if (asset.type === type && asset.name === authoredName) return asset.scope
    }
  }
  return null
}

function compareClaimants(a: ClaimantModel, b: ClaimantModel): number {
  return (
    compareStrings(a.facet, b.facet) || compareStrings(a.type, b.type) || compareStrings(a.authoredName, b.authoredName)
  )
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings)
}

/** Validate an alias exactly as the planner will. */
export function validateAlias(value: string): string | null {
  const result = validateAssetNameSegment(value)
  return result.ok ? null : result.reason
}
