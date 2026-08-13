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

/** What a generic name claim carries for the server domain. */
interface ServerClaim {
  declaration: ReadonlyMcpServerDeclaration
  fingerprint: McpServerFingerprint
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
  const result = planEffectiveNames<ServerClaim>(
    contributions.map((contribution) => ({
      owner: contribution.facet,
      claims: contribution.servers.map((server) => {
        // Cloned exactly once per contributed declaration, and fingerprinted
        // from the clone. Every view below shares this one frozen object, so
        // the plan cannot become internally inconsistent and cannot be
        // desynchronized from its fingerprint by a mutation of the input.
        const declaration = freezeMcpServerDeclaration(server.declaration)
        return {
          owner: contribution.facet,
          group: SERVER_OVERRIDE_GROUP,
          // One group, so the order among groups is constant and the effective
          // ordering falls through to the authored name.
          groupOrder: 0,
          authoredName: server.name,
          space: SERVER_SPACE,
          value: { declaration, fingerprint: computeMcpServerFingerprint(declaration) },
        }
      }),
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
          declaration: member.claim.value.declaration,
          fingerprint: member.claim.value.fingerprint,
          disposition: member.disposition,
        })),
      })),
      staleOverrides,
    }
  }

  const planned: PlannedServer[] = result.planned.map((entry) => ({
    facet: entry.claim.owner,
    authoredName: entry.claim.authoredName,
    declaration: entry.claim.value.declaration,
    fingerprint: entry.claim.value.fingerprint,
    disposition: entry.disposition,
  }))

  const configurations: PlannedServerConfiguration[] = result.identities.map((identity) => {
    // Safe: the core never emits an identity with no members, and every
    // member of one identity shares a fingerprint here — that is exactly what
    // made the group uncontested.
    const first = identity.members[0] as MaterializedName<ServerClaim>
    return {
      identity: { kind: 'mcp-server', effectiveName: identity.effectiveName },
      key: mcpServerKey(identity.effectiveName),
      declaration: first.claim.value.declaration,
      fingerprint: first.claim.value.fingerprint,
      claimants: identity.members.map((member) => ({
        facet: member.claim.owner,
        authoredName: member.claim.authoredName,
        disposition: member.disposition,
      })),
    }
  })

  return { ok: true, planned, configurations, staleOverrides }
}
