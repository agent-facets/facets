import type { McpServerPreparationOutcome } from '@agent-facets/adapter'
import {
  compareCodeUnits,
  type McpServerDeclaration,
  type McpServerFingerprint,
  type McpServerIdentity,
  type PlannedServerConfiguration,
  type ServerClaimant,
} from '@agent-facets/protocol'
import { isDeclarationApproved, type PreviousMcpOwnership } from '../commit/server-ownership.ts'
import type { PreparedMcpAdapter } from './prepare.ts'

/**
 * MCP configuration consent: what a user is being asked to authorize, and how
 * this invocation is allowed to obtain that authorization.
 *
 * The thing being authorized is execution. A declaration names a command this
 * machine will hand to a tool to run, or an endpoint it will connect to, so
 * the decision cannot be derived from a fingerprint, inherited from a
 * teammate's commit, or implied by having installed a facet. It is answered
 * per machine, recorded only in the machine-local receipt, and only by a
 * successful commit.
 */

/** Why a declaration needs approval now. */
export type McpApprovalStanding =
  /** Nothing on this machine has ever owned this effective identity. */
  | { kind: 'unknown-identity' }
  /**
   * This identity is owned, but under a different declaration.
   *
   * Tagged rather than carrying the previous declaration: the receipt stores
   * fingerprints only, so what it changed *from* is genuinely unavailable. A
   * field for it would be permanently empty or permanently a guess.
   */
  | { kind: 'declaration-changed' }

/** One effective declaration this machine has not approved. */
export interface McpDeclarationApproval {
  identity: McpServerIdentity
  fingerprint: McpServerFingerprint
  /**
   * The exact declaration. This is the consent payload — a user cannot
   * authorize a command from a hash — and one of only two places a
   * declaration is allowed to travel outward.
   */
  declaration: McpServerDeclaration
  /** Every facet claiming this identity, in the planner's order. */
  claimants: readonly ServerClaimant[]
  standing: McpApprovalStanding
}

/** One untracked native entry an approved plan would adopt or replace. */
export interface McpNativeTakeover {
  adapter: string
  identity: McpServerIdentity
  /**
   * What the adapter proved about the entry already there. Two literals
   * rather than a boolean: `equivalent` means it is adopted with no write at
   * all, `divergent` means it is overwritten — different things to tell a
   * user, and a boolean would read the same for a field added later.
   */
  existing: 'equivalent' | 'divergent'
  /** The declaration that would be adopted or written at this identity. */
  declaration: McpServerDeclaration
}

/**
 * The single MCP-configuration-only request.
 *
 * Never empty. That is refined at the boundary rather than encoded in the
 * type: "at least one across two lists" is not expressible without a third
 * tag, and {@link deriveMcpConsent} is the only constructor — it answers
 * `satisfied` instead of handing back an empty request.
 *
 * It carries only MCP declarations and MCP native takeovers. Asset collision
 * resolution and asset takeover are separate decisions with separate screens,
 * and approving execution must never be the act that also accepts overwriting
 * someone's hand-written file.
 */
export interface McpConsentRequest {
  declarations: readonly McpDeclarationApproval[]
  takeovers: readonly McpNativeTakeover[]
}

export type McpConsentRequirement = { kind: 'satisfied' } | { kind: 'required'; request: McpConsentRequest }

/**
 * The answer. Payload-free on purpose: approval accepts the complete
 * displayed set, so a partial answer is not a thing a user can give and not a
 * thing this type should be able to represent.
 */
export type McpConsentDecision = { kind: 'approved' } | { kind: 'declined' }

export type McpConsentResolver = (request: McpConsentRequest) => Promise<McpConsentDecision>

/**
 * How this invocation may obtain approval.
 *
 * One tagged field rather than an `acceptMcp` boolean beside an optional
 * resolver, which would make four combinations representable for three real
 * states and leave "flag set AND resolver supplied" to a comment. It also
 * keeps frozen mode expressible without a special case: frozen resolves to
 * `preapproved` when the flag was supplied and `unavailable` otherwise, and
 * never reaches the arm that can prompt.
 */
export type McpConsentPolicy =
  /** `--accept-mcp`. Never prompts; the only arm frozen mode may use. */
  | { kind: 'preapproved' }
  /** An interactive, non-frozen caller. */
  | { kind: 'interactive'; resolve: McpConsentResolver }
  /** Non-interactive with no opt-in: fail before mutation with the full list. */
  | { kind: 'unavailable' }

/**
 * What a policy produced for a request.
 *
 * `unavailable` is a third arm here but not on {@link McpConsentDecision}:
 * "this caller had no way to answer" is a property of the invocation, not an
 * answer a user gave, and the two lead to different failures — one tells you
 * to pass a flag, the other tells you nothing was approved.
 */
export type McpConsentSettlement = McpConsentDecision | { kind: 'unavailable' }

/** Obtain approval under a policy. Prompts only on the `interactive` arm. */
export async function settleMcpConsent(
  policy: McpConsentPolicy,
  request: McpConsentRequest,
): Promise<McpConsentSettlement> {
  switch (policy.kind) {
    case 'preapproved':
      return { kind: 'approved' }
    case 'unavailable':
      return { kind: 'unavailable' }
    case 'interactive':
      return await policy.resolve(request)
  }
}

export interface DeriveMcpConsentArgs {
  /** The active effective configurations this run would reconcile. */
  configurations: readonly PlannedServerConfiguration[]
  /** Approval evidence from the receipt. Empty for a pre-`0.4` receipt. */
  previousOwnership: ReadonlyMap<string, PreviousMcpOwnership>
  /** Every adapter's read-only preparation, which is where occupancy is known. */
  prepared: readonly PreparedMcpAdapter[]
}

/**
 * Compute what still needs approving.
 *
 * Two independent questions, deliberately not collapsed: whether this machine
 * has approved a declaration (asked of the receipt) and whether a native
 * entry it does not own is already sitting at that name (asked of the
 * adapter's preparation). A declaration can be approved while its destination
 * is occupied by something else, and an unapproved declaration can be landing
 * somewhere empty.
 */
export function deriveMcpConsent(args: DeriveMcpConsentArgs): McpConsentRequirement {
  const declarations: McpDeclarationApproval[] = []
  for (const configuration of args.configurations) {
    if (isDeclarationApproved(args.previousOwnership, configuration)) continue
    declarations.push({
      identity: configuration.identity,
      fingerprint: configuration.fingerprint,
      declaration: configuration.declaration,
      claimants: configuration.claimants,
      standing: args.previousOwnership.has(configuration.key)
        ? { kind: 'declaration-changed' }
        : { kind: 'unknown-identity' },
    })
  }
  declarations.sort((a, b) => compareCodeUnits(a.identity.effectiveName, b.identity.effectiveName))

  const byName = new Map(args.configurations.map((c) => [c.identity.effectiveName, c]))
  const takeovers: McpNativeTakeover[] = []
  for (const { adapter, preparation } of args.prepared) {
    for (const outcome of preparation.outcomes) {
      const existing = untrackedOccupancy(outcome)
      if (existing === null) continue
      const configuration = byName.get(outcome.name)
      // An outcome naming something the desired set does not contain would be
      // an adapter reporting on an entry it was never asked about. Skipping
      // is the conservative reading: nothing is disclosed, so nothing is
      // authorized, and the entry is left alone.
      if (configuration === undefined) continue
      takeovers.push({
        adapter,
        identity: configuration.identity,
        existing,
        declaration: configuration.declaration,
      })
    }
  }
  takeovers.sort(
    (a, b) =>
      compareCodeUnits(a.adapter, b.adapter) || compareCodeUnits(a.identity.effectiveName, b.identity.effectiveName),
  )

  if (declarations.length === 0 && takeovers.length === 0) return { kind: 'satisfied' }
  return { kind: 'required', request: { declarations, takeovers } }
}

/**
 * Whether one outcome describes an untracked entry that is actually there.
 *
 * An exhaustive switch rather than a filter: `absent` and `untracked` is a
 * pure addition with nothing to take over, and that is exactly the
 * distinction a predicate would be free to get wrong. A new outcome kind
 * fails to compile here, which is the point.
 */
function untrackedOccupancy(outcome: McpServerPreparationOutcome): 'equivalent' | 'divergent' | null {
  switch (outcome.kind) {
    case 'absent':
      return null
    case 'equivalent':
      return outcome.ownership === 'untracked' ? 'equivalent' : null
    case 'divergent':
      return outcome.ownership === 'untracked' ? 'divergent' : null
    case 'obsolete-owned':
      // Owned by definition — removing it needs no new approval.
      return null
  }
}
