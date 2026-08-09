import type { AssetType, Scope } from '@agent-facets/common'
import type {
  CollisionFacetContribution,
  CollisionResolutionRequest,
  MaterializationCollisionGroup,
  StaleMaterializationOverride,
} from '@agent-facets/engine'
import { overrideGroupFor, ownEntry, ownRecord, planCollisionIntent } from '@agent-facets/engine'
import type {
  FacetMaterializationOverrides,
  MaterializationDisposition,
  McpServerDeclaration,
  McpServerFingerprint,
} from '@agent-facets/protocol'
import { compareCodeUnits, isMaterialized, materializedNameOf, validateAssetNameSegment } from '@agent-facets/protocol'
import type { CollisionStatus } from '../collision-status.ts'

/**
 * The collision workspace's state, and the pure rule that turns it into
 * something renderable.
 *
 * Three properties drive the whole design:
 *
 *  1. **There is exactly one draft, and it is the same shape the engine
 *     consumes.** The draft IS a `Record<facet, overrides>` — the same
 *     durable project intent a user could have typed into `facets.json`.
 *     There is no parallel "UI choice" model to keep in sync, so the
 *     thing shown and the thing submitted cannot disagree.
 *
 *  2. **Collision truth comes from the shared planner, always.** This
 *     module never decides what collides. It arranges the planner's
 *     answer for display, and it calls the SAME function the engine calls
 *     to validate the submitted draft. That is what keeps the live preview
 *     and the final validation from disagreeing — a disagreement would show
 *     a green confirm button that then fails the install.
 *
 *  3. **Assets and MCP servers are separate identity spaces, and stay
 *     separate here.** A skill named `review` and a server named `review`
 *     never contend. The planner guarantees it; this module preserves it by
 *     never merging a group from one domain with a group from the other.
 */

/**
 * One contributor to a contested name.
 *
 * Tagged, not a widened struct: a server has no scope and no asset type, and
 * an asset has no declaration. A single shape with all of those optional
 * would let a renderer read an asset type off a server row and print nothing
 * where a kind belongs.
 */
export type ClaimantRef =
  | { kind: 'asset'; facet: string; scope: Scope; type: AssetType; authoredName: string }
  | {
      kind: 'mcp-server'
      facet: string
      authoredName: string
      declaration: McpServerDeclaration
      fingerprint: McpServerFingerprint
    }

/**
 * Stable identity for a claimant. NUL-joined and domain-prefixed, because
 * neither separator nor prefix can occur in a facet name, an asset name, a
 * scope, or a server name — so no combination of legal values can forge
 * another claimant's key, in either domain.
 */
export function claimantKey(ref: ClaimantRef): string {
  return ref.kind === 'asset'
    ? `asset\u0000${ref.facet}\u0000${ref.scope}\u0000${ref.type}\u0000${ref.authoredName}`
    : `mcp-server\u0000${ref.facet}\u0000${ref.authoredName}`
}

export interface CollisionDraft {
  /**
   * Complete project intent. Handed to the engine verbatim, so facets,
   * assets, and servers the workspace never displays keep the overrides they
   * arrived with.
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

/** What a claimant looks like once the planner has ruled on the draft. */
export interface ClaimantModel {
  ref: ClaimantRef
  key: string
  facet: string
  authoredName: string
  disposition: MaterializationDisposition
  /** Empty when omitted — there is no effective name to show. */
  effectiveName: string | null
  status: CollisionStatus
  /** Other claimants contesting this name right now, for navigation. */
  conflictsWith: readonly string[]
  /** Why the current alias is not a legal name, if it isn't. */
  aliasError: string | null
}

export interface DisplayGroup {
  key: string
  /** Which identity space this group lives in. Groups never mix. */
  kind: ClaimantRef['kind']
  /**
   * What to call this group on screen. Always non-empty.
   *
   * Computed here rather than at each render site because the obvious
   * expression — contested names, falling back to origin — has a real hole: a
   * claimant dragged in by an alias and then released keeps its row (the
   * workspace only grows) but belongs to no original group and contests
   * nothing, leaving both sources empty. Two views spelled that fallback
   * independently, so both rendered a blank heading above "(1 asset)".
   */
  title: string
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
   * Whether the complete draft plans cleanly, in BOTH domains. This is the
   * planner's verdict, not a count of green rows: the confirm gate and the
   * engine's final check then answer the same question the same way.
   */
  confirmable: boolean
  staleOverrides: readonly StaleMaterializationOverride[]
}

/** Seed a draft from the overrides the project already has. */
export function createDraft(request: CollisionResolutionRequest): CollisionDraft {
  // Null-prototype, because the keys are facet names straight out of
  // `facets.json`. A facet named `__proto__` assigned into a plain `{}`
  // creates no own key and replaces the map's prototype instead.
  //
  // Seeded from the project's COMPLETE intent, not just the colliding facets:
  // the resolver's answer is a whole intent document, so an override this
  // workspace never displays would be erased by omission.
  const overrides = ownRecord<FacetMaterializationOverrides>(request.overrides)
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

  // An alias can pull in a contribution that was never colliding. Surface it
  // immediately: the user has to be able to reach the other side of a
  // conflict they just created. The complete set is re-planned, so an MCP
  // alias surfaces the MCP claimant it landed on.
  const claimants = new Map(draft.claimants)
  const planned = planCollisionIntent(request.facets, overrides)
  if (!planned.ok && planned.reason === 'collision') {
    for (const [key, value] of claimantsOf(planned.groups)) {
      if (!claimants.has(key)) claimants.set(key, value)
    }
  }

  return { overrides, edited, claimants }
}

/** Arrange the planner's current verdict for display. */
export function evaluateDraft(request: CollisionResolutionRequest, draft: CollisionDraft): WorkspaceModel {
  const planned = planCollisionIntent(request.facets, draft.overrides)

  const currentGroups = !planned.ok && planned.reason === 'collision' ? planned.groups : []

  // Defensive, not expected: the workspace commits an alias only after the
  // same validator accepts it, and the engine rejects an unparseable
  // persisted alias before ever opening a resolver. Kept so that a draft
  // holding a bad alias explains itself instead of showing a green row beside
  // a disabled confirm button.
  //
  // Keyed by what an OVERRIDE is keyed by — facet, group, authored name — and
  // deliberately not by scope, which no override carries. An asset problem
  // therefore attaches to every scope contributing that authored name, which
  // is exactly the set of rows the one bad alias would affect.
  const aliasErrors = new Map<string, string>()
  if (!planned.ok && planned.reason === 'invalid-alias') {
    for (const problem of planned.problems) {
      aliasErrors.set(aliasProblemKey(problem), problem.reason)
    }
  }

  // Which claimants are contesting a name right now, and with whom.
  const conflictsWith = new Map<string, string[]>()
  const contestedNameOf = new Map<string, string>()
  for (const entry of currentGroups) {
    const keys = membersOf(entry).map((member) => claimantKey(member))
    for (const key of keys) {
      conflictsWith.set(
        key,
        keys.filter((other) => other !== key),
      )
      contestedNameOf.set(key, entry.group.effectiveName)
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
    const origin = component.origin.join(', ')
    return {
      key: component.key,
      kind: component.kind,
      title: titleFor(contested, origin, members),
      origin,
      contested,
      status: worstStatus(members.map((member) => member.status)),
      members,
    }
  })

  return {
    groups,
    confirmable: planned.ok,
    // Both domains, on every path. Reporting only the domain that happened to
    // plan would make a server's leftover choice vanish the moment an asset
    // collision was resolved.
    staleOverrides: planned.ok || planned.reason === 'collision' ? planned.staleOverrides : request.staleOverrides,
  }
}

/** The value handed back to the engine. */
export function draftOverrides(draft: CollisionDraft): Readonly<Record<string, FacetMaterializationOverrides>> {
  return draft.overrides
}

/** The current choice for one claimant. */
export function choiceFor(draft: CollisionDraft, ref: ClaimantRef): MaterializationDisposition {
  return draftOverrideFor(draft.overrides, ref) ?? { kind: 'authored' }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/** The claimant an invalid-alias problem belongs to, as a claimant key. */
function aliasProblemKey(problem: {
  kind: 'asset' | 'mcp-server'
  facet: string
  authoredName: string
  assetType?: AssetType
}): string {
  // Assets: scope is absent from both the problem and the override that
  // caused it, so the key is matched on the remaining segments. See
  // `claimantMatchesAliasProblem`.
  return problem.kind === 'asset'
    ? `asset-alias\u0000${problem.facet}\u0000${problem.assetType}\u0000${problem.authoredName}`
    : `mcp-server\u0000${problem.facet}\u0000${problem.authoredName}`
}

/** The alias-error key a claimant would be reported under. */
function aliasKeyOf(ref: ClaimantRef): string {
  return ref.kind === 'asset'
    ? `asset-alias\u0000${ref.facet}\u0000${ref.type}\u0000${ref.authoredName}`
    : `mcp-server\u0000${ref.facet}\u0000${ref.authoredName}`
}

/**
 * The heading for one group: what is contested now, else what brought these
 * claimants together, else what they are.
 *
 * The last fallback is the one that matters. A preserved singleton has no
 * contest and no original group, and a group whose heading is the empty
 * string reads as a rendering bug rather than as a row the user resolved.
 */
function titleFor(contested: readonly string[], origin: string, members: readonly ClaimantModel[]): string {
  if (contested.length > 0) return contested.join(', ')
  if (origin.length > 0) return origin
  return unique(members.map((member) => member.effectiveName ?? member.authoredName)).join(', ')
}

function modelFor(
  ref: ClaimantRef,
  draft: CollisionDraft,
  conflictsWith: ReadonlyMap<string, readonly string[]>,
  aliasErrors: ReadonlyMap<string, string>,
): ClaimantModel {
  const key = claimantKey(ref)
  const disposition = choiceFor(draft, ref)
  const conflicts = conflictsWith.get(key) ?? []
  const aliasError = aliasErrors.get(aliasKeyOf(ref)) ?? null

  return {
    ref,
    key,
    facet: ref.facet,
    authoredName: ref.authoredName,
    disposition,
    effectiveName: isMaterialized(disposition) ? materializedNameOf(ref.authoredName, disposition) : null,
    status: statusFor({ conflicts, aliasError, edited: draft.edited, key }),
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
 * claimant someone else's alias landed on would stay red and read as an
 * unrelated pre-existing problem.
 */
function statusFor(args: {
  key: string
  conflicts: readonly string[]
  aliasError: string | null
  edited: ReadonlySet<string>
}): CollisionStatus {
  const { key, conflicts, aliasError, edited } = args
  // An alias that isn't a legal name blocks confirmation, so it can never
  // read as settled — even though the planner reports no group for it.
  if (aliasError !== null) return 'unresolved'
  if (conflicts.length === 0) return 'resolved'
  const touched = [key, ...conflicts].some((member) => edited.has(member))
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

/** Every claimant of one tagged group, as refs. */
function membersOf(entry: MaterializationCollisionGroup): ClaimantRef[] {
  if (entry.kind === 'asset') {
    return entry.group.members.map((member) => ({
      kind: 'asset' as const,
      facet: member.facet,
      scope: member.scope,
      type: member.type,
      authoredName: member.authoredName,
    }))
  }
  return entry.group.members.map((member) => ({
    kind: 'mcp-server' as const,
    facet: member.facet,
    authoredName: member.authoredName,
    declaration: member.declaration,
    fingerprint: member.fingerprint,
  }))
}

/**
 * Partition claimants into the groups the user works through.
 *
 * Membership is the transitive closure of "was originally grouped with"
 * and "collides with right now". Union-find rather than a simple index by
 * contested name, because both relations move: aliasing one claimant onto
 * another group's name genuinely merges two problems into one decision,
 * and the user has to see them together to solve either.
 *
 * Only groups from the SAME identity space are ever unioned — which is free
 * here, since a group's members all come from one domain and no group spans
 * both. A skill and a server sharing a name are two rows the user resolves
 * independently, because that is what the planner says they are.
 */
function groupClaimants(
  originalGroups: readonly MaterializationCollisionGroup[],
  currentGroups: readonly MaterializationCollisionGroup[],
  claimants: ReadonlyMap<string, ClaimantRef>,
): ReadonlyArray<{ key: string; kind: ClaimantRef['kind']; origin: string[]; members: ClaimantRef[] }> {
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
  for (const entry of [...originalGroups, ...currentGroups]) {
    const keys = membersOf(entry).map((member) => claimantKey(member))
    const first = keys[0]
    if (first === undefined) continue
    for (const key of keys) {
      if (!parent.has(key)) parent.set(key, key)
      union(first, key)
    }
  }
  for (const entry of originalGroups) {
    const first = membersOf(entry)[0]
    if (first === undefined) continue
    const root = find(claimantKey(first))
    const names = originNames.get(root) ?? new Set<string>()
    names.add(entry.group.effectiveName)
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
      // Safe: every union above joins keys drawn from one group, and a group
      // has members from exactly one domain, so a component is single-domain
      // by construction.
      kind: (members[0] as ClaimantRef).kind,
      origin: [...(foldedOrigins.get(root) ?? new Set<string>())].sort(compareCodeUnits),
      members,
    }))
    .sort((a, b) => compareCodeUnits(a.origin.join(', '), b.origin.join(', ')) || compareCodeUnits(a.key, b.key))
}

function claimantsOf(groups: readonly MaterializationCollisionGroup[]): Map<string, ClaimantRef> {
  const claimants = new Map<string, ClaimantRef>()
  for (const entry of groups) {
    for (const ref of membersOf(entry)) {
      claimants.set(claimantKey(ref), ref)
    }
  }
  return claimants
}

/**
 * The draft's current choice for one claimant.
 *
 * Both lookups are own-property reads: facet names, asset names, and server
 * names are ordinary strings, so an indexed read for `constructor` or
 * `__proto__` would return an inherited value where the type promises a
 * disposition or `undefined`. Only the middle level — the override group — is
 * a closed literal union and therefore safe to index directly.
 */
function draftOverrideFor(
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
  ref: ClaimantRef,
): MaterializationDisposition | undefined {
  const facet = ownEntry(overrides, ref.facet)
  if (facet === undefined) return undefined
  const entries = facet[groupOf(ref)]
  return entries === undefined ? undefined : ownEntry(entries, ref.authoredName)
}

/** The `facets.json` override group this claimant's choice is written to. */
function groupOf(ref: ClaimantRef) {
  return overrideGroupFor(ref.kind === 'asset' ? { kind: 'asset', assetType: ref.type } : { kind: 'mcp-server' })
}

/**
 * The draft with one claimant's choice recorded, as a fresh map.
 *
 * Every copy is null-prototyped and every lookup is an own read, because both
 * outer levels are keyed by names from `facets.json`: the facet map by facet
 * name, the inner map by authored asset or server name. Writing
 * `entries[name] = disposition` into a plain object for a name spelled
 * `__proto__` recorded nothing, and the empty-group check below then deleted
 * the group the user had just edited.
 */
function withOverride(
  overrides: Readonly<Record<string, FacetMaterializationOverrides>>,
  ref: ClaimantRef,
  disposition: MaterializationDisposition,
): Record<string, FacetMaterializationOverrides> {
  const group = groupOf(ref)
  const next = ownRecord(overrides)
  const facet: FacetMaterializationOverrides = { ...ownEntry(next, ref.facet) }
  const entries = ownRecord(facet[group])

  if (disposition.kind === 'authored') {
    delete entries[ref.authoredName]
  } else {
    entries[ref.authoredName] = disposition
  }

  if (Object.keys(entries).length === 0) delete facet[group]
  else facet[group] = entries

  if (Object.keys(facet).length === 0) delete next[ref.facet]
  else next[ref.facet] = facet

  return next
}

/**
 * Deterministic row order: assets before servers, then by facet and name.
 *
 * The domain leads because a mixed group cannot occur — so within any group
 * this is a constant — while the overview lists groups whose members must
 * still sort predictably for a reader comparing two runs.
 */
function compareClaimants(a: ClaimantModel, b: ClaimantModel): number {
  return (
    compareCodeUnits(a.ref.kind, b.ref.kind) ||
    compareCodeUnits(a.facet, b.facet) ||
    compareCodeUnits(a.ref.kind === 'asset' ? a.ref.type : '', b.ref.kind === 'asset' ? b.ref.type : '') ||
    compareCodeUnits(a.authoredName, b.authoredName)
  )
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits)
}

/**
 * Validate an alias exactly as the planner will.
 *
 * One validator for both domains, because there is one grammar: the published
 * server-name check delegates to this very function, so a divergence here
 * would be a divergence from itself.
 */
export function validateAlias(value: string): string | null {
  const result = validateAssetNameSegment(value)
  return result.ok ? null : result.reason
}

/** Re-exported so the workspace can name the contribution kinds it renders. */
export type { CollisionFacetContribution }
