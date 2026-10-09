import { computeMcpServerFingerprint, type McpServerFingerprint } from '../mcp/fingerprint.ts'
import { freezeMcpServerDeclaration } from '../mcp/freeze.ts'
import type {
  MaterializationDisposition,
  MaterializedDisposition,
  ProjectAssetOverride,
} from '../schemas/materialization.ts'
import type { ReadonlyMcpServerDeclaration } from '../schemas/mcp-server-declaration.ts'
import type { FacetMaterializationOverrides } from '../schemas/project-manifest.ts'
import { SERVER_OVERRIDE_GROUP } from '../schemas/project-manifest.ts'
import { type MaterializedName, planEffectiveNames } from './effective-name.ts'

/**
 * MCP server configuration planning — the server-domain wrapper over the
 * shared effective-name core.
 *
 * Servers deliberately do NOT become an `AssetType`. They occupy their own
 * identity space, so a skill and a server may both be called `review`
 * without contending, and that separation is structural: assets and servers
 * are planned by two independent calls, so no cross-domain contention can
 * arise from a string collision between a namespace and a kind.
 *
 * The one behavioral difference from assets is composition. Two facets
 * declaring the SAME server at the same effective name are not a conflict —
 * they describe one configuration with two claimants, and both are retained
 * for ownership and reporting. Only claims whose canonical fingerprints
 * differ contest, because only then is there no single configuration that
 * satisfies every claimant.
 */

/** The identity an MCP configuration is materialized under. Project scope is implicit. */
export interface McpServerIdentity {
  readonly kind: 'mcp-server'
  readonly effectiveName: string
}

/**
 * The identity space every server claim shares.
 *
 * Constant because the portable model is project-scoped only: there is no
 * user- or system-wide MCP configuration in this release, so there is
 * nothing for the space to vary over.
 */
const SERVER_SPACE = 'project\u0000mcp-server'

/** Servers are swept as a single override group. */
const SERVER_GROUPS: readonly string[] = [SERVER_OVERRIDE_GROUP]

/**
 * The concrete addressable key for one effective server identity.
 *
 * Ownership is project-wide and adapter-agnostic — selecting an adapter
 * delegates management of the identities the project already owns rather
 * than creating a second ownership axis — so the key deliberately carries no
 * adapter.
 */
export function mcpServerKey(effectiveName: string): string {
  return `mcp-server\u0000${effectiveName}`
}

/** One server a facet authored, with the declaration its manifest carried. */
export interface AuthoredServer {
  /** The name the publisher declared. Never an alias. */
  name: string
  /**
   * Accepted as read-only: the planner clones what it is given, so a caller
   * may pass a declaration it still owns and keep using it afterwards.
   */
  declaration: ReadonlyMcpServerDeclaration
}

/** One facet's server contributions, with the project's intent for them. */
export interface ServerContribution {
  facet: string
  servers: readonly AuthoredServer[]
  /** Keyed by group and then AUTHORED name; absence means authored materialization. */
  overrides?: FacetMaterializationOverrides | undefined
}

/** An authored server and the disposition the project resolved for it. */
export interface PlannedServer {
  facet: string
  authoredName: string
  declaration: ReadonlyMcpServerDeclaration
  fingerprint: McpServerFingerprint
  /** All three arms — an omitted server is still planned, just not configured. */
  disposition: MaterializationDisposition
}

/** One facet's claim on an effective configuration. */
export interface ServerClaimant {
  facet: string
  authoredName: string
  disposition: MaterializedDisposition
}

/**
 * One effective MCP configuration to reconcile, plus every facet claiming it.
 *
 * Several claimants means several facets declared the identical server; the
 * complete set is retained because ownership, reporting, and removal all
 * need to know whether a remaining facet still wants the configuration.
 */
export interface PlannedServerConfiguration {
  identity: McpServerIdentity
  /** The addressable ownership key for {@link identity}. */
  key: string
  declaration: ReadonlyMcpServerDeclaration
  fingerprint: McpServerFingerprint
  /** Always at least one, deterministically ordered. */
  claimants: readonly ServerClaimant[]
}

/** One claimant of a contested effective server name. */
export interface ServerCollisionMember {
  facet: string
  authoredName: string
  effectiveName: string
  declaration: ReadonlyMcpServerDeclaration
  fingerprint: McpServerFingerprint
  disposition: MaterializationDisposition
}

/** Two or more materially different declarations claiming one effective name. */
export interface ServerCollisionGroup {
  effectiveName: string
  /** Always two or more, deterministically ordered. */
  members: readonly ServerCollisionMember[]
}

/** An override naming a server the resolved facet does not declare. */
export interface StaleServerOverride {
  facet: string
  authoredName: string
  disposition: ProjectAssetOverride
}

/** An override whose server alias does not satisfy the portable name grammar. */
export interface InvalidServerAlias {
  facet: string
  authoredName: string
  alias: string
  reason: string
}

/** The server planner's result, mirroring the asset planner's three arms. */
export type PlanServerMaterializationResult =
  | {
      ok: true
      /** Every authored server with its final disposition, including omitted ones. */
      planned: readonly PlannedServer[]
      /** The effective configurations to reconcile, one per identity. */
      configurations: readonly PlannedServerConfiguration[]
      staleOverrides: readonly StaleServerOverride[]
    }
  | { ok: false; reason: 'invalid-alias'; problems: readonly InvalidServerAlias[] }
  | {
      ok: false
      reason: 'collision'
      groups: readonly ServerCollisionGroup[]
      staleOverrides: readonly StaleServerOverride[]
    }

// --- Fingerprint-only planning over locked inventory ---

/** One authored server known only by its canonical declaration fingerprint. */
export interface LockedServerRecord {
  /** The name the publisher declared. Never an alias. */
  readonly name: string
  readonly fingerprint: McpServerFingerprint
}

/**
 * One facet's complete fingerprint-only server inventory, with the project's
 * intent for it. Absence of an override means authored materialization —
 * never "keep whatever another document recorded".
 */
export interface LockedServerContribution {
  readonly facet: string
  readonly servers: readonly LockedServerRecord[]
  readonly overrides?: FacetMaterializationOverrides | undefined
}

/** An authored server and the disposition the project resolved for it. */
export interface PlannedLockedServer {
  readonly facet: string
  readonly authoredName: string
  readonly fingerprint: McpServerFingerprint
  /** All three arms — an omitted server is still planned, just not selected. */
  readonly disposition: Readonly<MaterializationDisposition>
}

/** One facet's claim on a selected effective server. */
export interface LockedServerClaimant {
  readonly facet: string
  readonly authoredName: string
  readonly disposition: Readonly<MaterializedDisposition>
}

/** One selected effective server identity plus every claimant of it. */
export interface PlannedLockedServerConfiguration {
  readonly identity: Readonly<McpServerIdentity>
  /** The addressable ownership key for {@link identity}. */
  readonly key: string
  readonly fingerprint: McpServerFingerprint
  /** Always at least one, deterministically ordered. */
  readonly claimants: readonly LockedServerClaimant[]
}

/** One claimant of a contested effective server name, without its declaration. */
export interface LockedServerCollisionMember {
  readonly facet: string
  readonly authoredName: string
  readonly effectiveName: string
  readonly fingerprint: McpServerFingerprint
  readonly disposition: Readonly<MaterializationDisposition>
}

/** Two or more differing fingerprints claiming one effective name. */
export interface LockedServerCollisionGroup {
  readonly effectiveName: string
  /** Always two or more, deterministically ordered. */
  readonly members: readonly LockedServerCollisionMember[]
}

/**
 * The fingerprint-only planner's result. The same three arms as
 * {@link PlanServerMaterializationResult}, minus every declaration payload.
 * Nothing here asserts that a fingerprint was verified against content.
 */
export type PlanLockedServerInventoryResult =
  | {
      readonly ok: true
      /** Every authored server with its final disposition, including omitted ones. */
      readonly planned: readonly PlannedLockedServer[]
      /** The selected configurations, one per identity. */
      readonly configurations: readonly PlannedLockedServerConfiguration[]
      readonly staleOverrides: readonly Readonly<StaleServerOverride>[]
    }
  | { readonly ok: false; readonly reason: 'invalid-alias'; readonly problems: readonly Readonly<InvalidServerAlias>[] }
  | {
      readonly ok: false
      readonly reason: 'collision'
      readonly groups: readonly LockedServerCollisionGroup[]
      readonly staleOverrides: readonly Readonly<StaleServerOverride>[]
    }

// --- The shared server-claim core ---

/** The minimum every server claim value carries: the equivalence it composes by. */
interface ServerClaimValue {
  readonly fingerprint: McpServerFingerprint
}

interface ServerClaimContribution<V extends ServerClaimValue> {
  facet: string
  claims: readonly { name: string; value: V }[]
  overrides?: FacetMaterializationOverrides | undefined
}

interface ServerClaimPlanned<V> {
  facet: string
  authoredName: string
  value: V
  disposition: MaterializationDisposition
}

interface ServerClaimConfiguration<V> {
  effectiveName: string
  /** The first claimant's value; every claimant shares its fingerprint. */
  value: V
  claimants: ServerClaimant[]
}

interface ServerClaimCollisionMember<V> {
  facet: string
  authoredName: string
  effectiveName: string
  value: V
  disposition: MaterializationDisposition
}

type PlanServerClaimsResult<V> =
  | {
      ok: true
      planned: ServerClaimPlanned<V>[]
      configurations: ServerClaimConfiguration<V>[]
      staleOverrides: StaleServerOverride[]
    }
  | { ok: false; reason: 'invalid-alias'; problems: InvalidServerAlias[] }
  | {
      ok: false
      reason: 'collision'
      groups: { effectiveName: string; members: ServerClaimCollisionMember<V>[] }[]
      staleOverrides: StaleServerOverride[]
    }

/**
 * The one server-domain planning rule, behind both public wrappers.
 *
 * Owns everything that makes a server a server rather than an asset: the
 * identity space, the single override group, and composition by fingerprint
 * equality. The wrappers differ only in what each claim's `value` carries —
 * a frozen declaration plus its fingerprint, or a fingerprint alone — so the
 * declaration-based and fingerprint-only plans cannot drift apart on naming,
 * ordering, aliasing, collision, or stale-intent semantics.
 */
function planServerClaims<V extends ServerClaimValue>(
  contributions: readonly ServerClaimContribution<V>[],
): PlanServerClaimsResult<V> {
  const result = planEffectiveNames<V>(
    contributions.map((contribution) => ({
      owner: contribution.facet,
      claims: contribution.claims.map((claim) => ({
        owner: contribution.facet,
        group: SERVER_OVERRIDE_GROUP,
        // One group, so the order among groups is constant and the effective
        // ordering falls through to the authored name.
        groupOrder: 0,
        authoredName: claim.name,
        space: SERVER_SPACE,
        value: claim.value,
      })),
      overrides: contribution.overrides,
    })),
    {
      groups: SERVER_GROUPS,
      // Identical declarations describe one configuration, so they compose
      // rather than contest. Only a disagreement about what the server IS
      // blocks a plan.
      contested: (members) => new Set(members.map((member) => member.claim.value.fingerprint)).size > 1,
    },
  )

  if (!result.ok && result.reason === 'invalid-alias') {
    return {
      ok: false,
      reason: 'invalid-alias',
      problems: result.problems.map((problem) => ({
        facet: problem.owner,
        authoredName: problem.authoredName,
        alias: problem.alias,
        reason: problem.reason,
      })),
    }
  }

  const staleOverrides: StaleServerOverride[] = result.stale.map((entry) => ({
    facet: entry.owner,
    authoredName: entry.authoredName,
    disposition: entry.disposition,
  }))

  if (!result.ok) {
    return {
      ok: false,
      reason: 'collision',
      groups: result.groups.map((group) => ({
        effectiveName: group.effectiveName,
        members: group.members.map((member) => ({
          facet: member.claim.owner,
          authoredName: member.claim.authoredName,
          effectiveName: member.effectiveName,
          value: member.claim.value,
          disposition: member.disposition,
        })),
      })),
      staleOverrides,
    }
  }

  const planned = result.planned.map((entry) => ({
    facet: entry.claim.owner,
    authoredName: entry.claim.authoredName,
    value: entry.claim.value,
    disposition: entry.disposition,
  }))

  const configurations = result.identities.map((identity) => {
    // Safe: the core never emits an identity with no members, and every
    // member of one identity shares a fingerprint here — that is exactly what
    // made the group uncontested.
    const first = identity.members[0] as MaterializedName<V>
    return {
      effectiveName: identity.effectiveName,
      value: first.claim.value,
      claimants: identity.members.map((member) => ({
        facet: member.claim.owner,
        authoredName: member.claim.authoredName,
        disposition: member.disposition,
      })),
    }
  })

  return { ok: true, planned, configurations, staleOverrides }
}

// --- Public wrappers ---

/** What a declaration-based claim carries for the server domain. */
interface ServerClaim extends ServerClaimValue {
  declaration: ReadonlyMcpServerDeclaration
}

/**
 * Plan MCP server configuration over the complete desired set.
 *
 * Aliases and omissions apply first, then active claims group by effective
 * name. Claims sharing a fingerprint compose into one configuration; claims
 * that disagree produce one complete collision group naming every claimant,
 * with no winner chosen by ordering.
 */
export function planServerMaterialization(
  contributions: readonly ServerContribution[],
): PlanServerMaterializationResult {
  const result = planServerClaims<ServerClaim>(
    contributions.map((contribution) => ({
      facet: contribution.facet,
      claims: contribution.servers.map((server) => {
        // Cloned exactly once per contributed declaration, and fingerprinted
        // from the clone. Every view below shares this one frozen object, so
        // the plan cannot become internally inconsistent and cannot be
        // desynchronized from its fingerprint by a mutation of the input.
        const declaration = freezeMcpServerDeclaration(server.declaration)
        return { name: server.name, value: { declaration, fingerprint: computeMcpServerFingerprint(declaration) } }
      }),
      overrides: contribution.overrides,
    })),
  )

  if (!result.ok) {
    if (result.reason === 'invalid-alias') return result
    return {
      ok: false,
      reason: 'collision',
      groups: result.groups.map((group) => ({
        effectiveName: group.effectiveName,
        members: group.members.map((member) => ({
          facet: member.facet,
          authoredName: member.authoredName,
          effectiveName: member.effectiveName,
          declaration: member.value.declaration,
          fingerprint: member.value.fingerprint,
          disposition: member.disposition,
        })),
      })),
      staleOverrides: result.staleOverrides,
    }
  }

  const planned: PlannedServer[] = result.planned.map((entry) => ({
    facet: entry.facet,
    authoredName: entry.authoredName,
    declaration: entry.value.declaration,
    fingerprint: entry.value.fingerprint,
    disposition: entry.disposition,
  }))

  const configurations: PlannedServerConfiguration[] = result.configurations.map((configuration) => ({
    identity: { kind: 'mcp-server', effectiveName: configuration.effectiveName },
    key: mcpServerKey(configuration.effectiveName),
    declaration: configuration.value.declaration,
    fingerprint: configuration.value.fingerprint,
    claimants: configuration.claimants,
  }))

  return { ok: true, planned, configurations, staleOverrides: result.staleOverrides }
}

/**
 * Plan MCP server materialization from complete fingerprint-only inventories.
 *
 * Follows exactly the rules of {@link planServerMaterialization} — it is the
 * same core — but needs no declaration, so locked records can be planned
 * against project intent without fetching facet content or fabricating
 * declarations. Each contribution must be a facet's COMPLETE authored server
 * set, including servers with no override and facets with no servers, so
 * stale intent is detected everywhere.
 *
 * Supplied fingerprints are planned as given; nothing in the result asserts
 * they were verified against a declaration or an archive.
 */
export function planLockedServerInventory(
  contributions: readonly LockedServerContribution[],
): PlanLockedServerInventoryResult {
  const result = planServerClaims<ServerClaimValue>(
    contributions.map((contribution) => ({
      facet: contribution.facet,
      claims: contribution.servers.map((server) => ({ name: server.name, value: { fingerprint: server.fingerprint } })),
      overrides: contribution.overrides,
    })),
  )

  if (!result.ok) {
    if (result.reason === 'invalid-alias') return result
    return {
      ok: false,
      reason: 'collision',
      groups: result.groups.map((group) => ({
        effectiveName: group.effectiveName,
        members: group.members.map((member) => ({
          facet: member.facet,
          authoredName: member.authoredName,
          effectiveName: member.effectiveName,
          fingerprint: member.value.fingerprint,
          disposition: member.disposition,
        })),
      })),
      staleOverrides: result.staleOverrides,
    }
  }

  return {
    ok: true,
    planned: result.planned.map((entry) => ({
      facet: entry.facet,
      authoredName: entry.authoredName,
      fingerprint: entry.value.fingerprint,
      disposition: entry.disposition,
    })),
    configurations: result.configurations.map((configuration) => ({
      identity: { kind: 'mcp-server', effectiveName: configuration.effectiveName },
      key: mcpServerKey(configuration.effectiveName),
      fingerprint: configuration.value.fingerprint,
      claimants: configuration.claimants,
    })),
    staleOverrides: result.staleOverrides,
  }
}
