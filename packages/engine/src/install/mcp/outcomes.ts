import type { McpServerPreparationOutcome } from '@agent-facets/adapter'
import {
  compareCodeUnits,
  mcpServerKey,
  type PlannedServer,
  type PlannedServerConfiguration,
  sameDisposition,
} from '@agent-facets/protocol'
import { isDeclarationApproved, type PreviousMcpOwnership } from '../commit/server-ownership.ts'
import type { ProjectReceiptState, ReceiptConfigurationClaim } from '../receipt.ts'
import type { McpApprovalStanding, McpConsentRequest } from './consent.ts'
import type { PreparedMcpAdapter } from './prepare.ts'

/**
 * What an operation did to this project's MCP configuration.
 *
 * Two independent axes, deliberately not collapsed into one status. INTENT is
 * what the project asked for — a declaration, an alias, an omission — and
 * lives in `facets.json` plus the facet's manifest. NATIVE STATE is what a
 * tool's own configuration file holds. They move independently: a changed
 * declaration whose native rendering happens to match is an intent update and
 * a native no-op, and a native file someone edited by hand is a repair with no
 * intent change at all. One status field would have to pick a winner.
 *
 * These types carry identities, adapters, and statuses. The declarations
 * themselves stay in the consent request, which is the surface whose whole
 * purpose is showing a user the exact command they are authorizing; routine
 * outcomes need names and never the payload.
 */

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/**
 * How this project's intent for one authored declaration compares with what
 * this machine last reconciled.
 *
 *   - `introduced` — a current record covers this facet and holds no claim for
 *     this declaration, which PROVES the declaration is new project intent.
 *   - `updated`    — the declaration, its alias, or its omission changed.
 *   - `unchanged`  — same declaration, same disposition.
 *   - `unrecorded` — the record covers no history for this facet at all, so a
 *     missing claim proves nothing. Separate from `introduced` because the two
 *     look identical at the claim level and mean opposite things: one is new
 *     intent, the other is a gap where evidence would be.
 *   - `unwitnessed`— this machine has no usable record of what it last did, so
 *     the comparison is unanswerable for every facet at once.
 */
export type McpIntentChange = 'introduced' | 'updated' | 'unchanged' | 'unrecorded' | 'unwitnessed'

/**
 * One authored declaration and what the project decided about it.
 *
 * Tagged by disposition so an effective name exists exactly where one is
 * meaningful: an omitted declaration has no effective identity at all, and an
 * authored one's effective name IS its authored name.
 */
export type McpDispositionOutcome =
  | { kind: 'authored'; facet: string; authoredName: string; change: McpIntentChange }
  | { kind: 'aliased'; facet: string; authoredName: string; effectiveName: string; change: McpIntentChange }
  | { kind: 'omitted'; facet: string; authoredName: string; change: McpIntentChange }

/**
 * What this machine can prove about its own previous MCP intent.
 *
 * `witnessed` with an empty map is a real and common answer — a project whose
 * receipt is simply absent has definitively never reconciled anything here.
 * It still records no history for any individual facet, which is why a claim
 * missing from it reads as `unrecorded` rather than as proof of new intent.
 * `unwitnessed` is the narrower case where a record exists but cannot speak:
 * a pre-`0.4` receipt, or one too damaged to read.
 */
export type McpIntentBaseline =
  | { kind: 'witnessed'; claims: ReadonlyMap<string, ReadonlyMap<string, ReceiptConfigurationClaim>> }
  | { kind: 'unwitnessed' }

/** Derive the intent baseline from this machine's receipt state. */
export function mcpIntentBaseline(state: ProjectReceiptState): McpIntentBaseline {
  if (state.kind === 'unavailable') {
    // A missing receipt proves absence: this machine has reconciled nothing
    // for this project. A corrupt or foreign one proves nothing at all.
    return state.reason === 'missing' ? { kind: 'witnessed', claims: new Map() } : { kind: 'unwitnessed' }
  }
  if (state.record.authority !== 'assets-and-configuration') return { kind: 'unwitnessed' }

  const claims = new Map<string, Map<string, ReceiptConfigurationClaim>>()
  for (const [facet, entry] of Object.entries(state.record.facets)) {
    const byName = new Map<string, ReceiptConfigurationClaim>()
    for (const claim of entry.configurations) byName.set(claim.name, claim)
    claims.set(facet, byName)
  }
  return { kind: 'witnessed', claims }
}

function intentChangeOf(baseline: McpIntentBaseline, planned: PlannedServer): McpIntentChange {
  if (baseline.kind === 'unwitnessed') return 'unwitnessed'
  const prior = baseline.claims.get(planned.facet)?.get(planned.authoredName)

  if (planned.disposition.kind === 'omitted') {
    // A receipt records only what it reconciled, so an omission is witnessed
    // by the ABSENCE of a claim. Having one means this machine configured the
    // server and the project has since withdrawn it.
    return prior === undefined ? 'unchanged' : 'updated'
  }
  if (prior === undefined) {
    // The receipt records an entry for every facet it committed, including one
    // that reconciled no servers. So "this facet is in the record" is what
    // turns an absent claim into proof that nothing was managed here before;
    // without it, the absence is just silence.
    return baseline.claims.has(planned.facet) ? 'introduced' : 'unrecorded'
  }
  const same = sameDisposition(prior.materialization, planned.disposition) && prior.fingerprint === planned.fingerprint
  return same ? 'unchanged' : 'updated'
}

/**
 * Classify every authored declaration's intent, including omitted ones.
 *
 * Omissions are the reason this reads `planned` rather than the active
 * configuration set: "the project omits this server" is unanswerable from the
 * identities that survived planning.
 */
export function classifyMcpDispositions(
  planned: readonly PlannedServer[],
  baseline: McpIntentBaseline,
): McpDispositionOutcome[] {
  const outcomes = planned.map((entry) => dispositionOutcomeOf(entry, intentChangeOf(baseline, entry)))
  outcomes.sort((a, b) => compareCodeUnits(a.facet, b.facet) || compareCodeUnits(a.authoredName, b.authoredName))
  return outcomes
}

function dispositionOutcomeOf(entry: PlannedServer, change: McpIntentChange): McpDispositionOutcome {
  const common = { facet: entry.facet, authoredName: entry.authoredName, change }
  switch (entry.disposition.kind) {
    case 'authored':
      return { kind: 'authored', ...common }
    case 'aliased':
      return { kind: 'aliased', ...common, effectiveName: entry.disposition.as }
    case 'omitted':
      return { kind: 'omitted', ...common }
  }
}

// ---------------------------------------------------------------------------
// Native reconciliation
// ---------------------------------------------------------------------------

/**
 * What reconciling one effective identity did to one adapter's native file.
 *
 *   - `added`     — nothing was there and this run created it.
 *   - `updated`   — the entry changed because the DECLARATION changed.
 *   - `repaired`  — the entry changed because the NATIVE state had drifted, or
 *     because an untracked entry was overwritten. The desired declaration was
 *     already what this project wanted.
 *   - `unchanged` — the adapter proved the native entry already matched, so
 *     nothing was written.
 */
export type McpActiveConfigurationStatus = 'added' | 'updated' | 'repaired' | 'unchanged'

/**
 * One adapter's reconciliation of one effective server identity.
 *
 * Tagged on whether the identity is still desired, because the two arms name
 * different facts: an active outcome's claimants are the facets that want it
 * NOW, while an obsolete one's are the facets that used to — a single
 * `claimants` field would read as the former while meaning the latter.
 */
export type McpConfigurationOutcome =
  | {
      kind: 'active'
      adapter: string
      effectiveName: string
      /** Every facet claiming this identity, in the planner's order. */
      claimants: readonly string[]
      status: McpActiveConfigurationStatus
      /** Whether this identity was occupied by an entry this machine did not own. */
      takenOver: boolean
    }
  | {
      kind: 'obsolete'
      adapter: string
      effectiveName: string
      /** Every facet that claimed this identity per the receipt. */
      previousClaimants: readonly string[]
      /**
       * `removed` deleted an entry that was there; `already-absent` dropped a
       * claim whose entry someone had already deleted by hand. Both end with
       * the identity unowned, and only the first is work a user did not do.
       */
      status: 'removed' | 'already-absent'
    }

export interface ClassifyMcpConfigurationsArgs {
  /** The active effective configurations this run reconciled. */
  configurations: readonly PlannedServerConfiguration[]
  /** Approval and ownership evidence from the receipt, as it was BEFORE this run. */
  previousOwnership: ReadonlyMap<string, PreviousMcpOwnership>
  /** Every adapter's read-only preparation — where occupancy and equality were decided. */
  prepared: readonly PreparedMcpAdapter[]
}

/**
 * Classify what each adapter's application did, from the evidence its
 * preparation already produced.
 *
 * Preparation is the authority rather than the apply result: it reports per
 * SERVER, while `apply` reports per document, so a mixed document ("one entry
 * added, one already correct") is only decomposable here. Applying a prepared
 * plan is defined to do exactly what preparation said it would, which is what
 * makes reading the earlier of the two sound.
 */
export function classifyMcpConfigurations(args: ClassifyMcpConfigurationsArgs): McpConfigurationOutcome[] {
  const byName = new Map(
    args.configurations.map((configuration) => [configuration.identity.effectiveName, configuration]),
  )
  const outcomes: McpConfigurationOutcome[] = []

  for (const { adapter, preparation } of args.prepared) {
    for (const outcome of preparation.outcomes) {
      if (outcome.kind === 'obsolete-owned') {
        const ownership = args.previousOwnership.get(mcpServerKey(outcome.name))
        outcomes.push({
          kind: 'obsolete',
          adapter,
          effectiveName: outcome.name,
          previousClaimants: ownership?.facets ?? [],
          status: outcome.occupancy === 'present' ? 'removed' : 'already-absent',
        })
        continue
      }

      const configuration = byName.get(outcome.name)
      // An outcome naming something the desired set does not contain would be
      // an adapter reporting on an entry it was never asked about. Skipped for
      // the same reason consent skips it: nothing was authorized, so nothing
      // is claimed here either.
      if (configuration === undefined) continue

      outcomes.push({
        kind: 'active',
        adapter,
        effectiveName: outcome.name,
        claimants: configuration.claimants.map((claimant) => claimant.facet),
        status: activeStatusOf(outcome, isDeclarationApproved(args.previousOwnership, configuration)),
        takenOver: outcome.ownership === 'untracked' && outcome.kind !== 'absent',
      })
    }
  }

  outcomes.sort((a, b) => compareCodeUnits(a.adapter, b.adapter) || compareCodeUnits(a.effectiveName, b.effectiveName))
  return outcomes
}

/**
 * Whether a write happened, and why.
 *
 * `approved` is the discriminator between the two reasons a tracked entry gets
 * rewritten: this machine already reconciled this exact declaration here, so a
 * difference on disk is drift someone introduced (`repaired`); a fingerprint it
 * has never approved means the project asked for something else (`updated`).
 */
function activeStatusOf(
  outcome: Exclude<McpServerPreparationOutcome, { kind: 'obsolete-owned' }>,
  approved: boolean,
): McpActiveConfigurationStatus {
  switch (outcome.kind) {
    case 'absent':
      // Untracked and absent is a plain creation. Tracked and absent means the
      // entry this machine owns is gone from the file.
      if (outcome.ownership === 'untracked') return 'added'
      return approved ? 'repaired' : 'updated'
    case 'equivalent':
      return 'unchanged'
    case 'divergent':
      // An untracked destination has no approved declaration to compare
      // against, so the rewrite is always a repair of state this project did
      // not put there.
      if (outcome.ownership === 'untracked') return 'repaired'
      return approved ? 'repaired' : 'updated'
  }
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/** One approval, without the declaration that was displayed to obtain it. */
export interface McpApprovalSummary {
  effectiveName: string
  claimants: readonly string[]
  standing: McpApprovalStanding
}

/** One disclosed untracked native entry, without the declaration. */
export interface McpTakeoverSummary {
  adapter: string
  effectiveName: string
  existing: 'equivalent' | 'divergent'
}

/**
 * What a user was asked to approve, in the form the rest of the system needs
 * afterwards.
 *
 * The full {@link McpConsentRequest} exists so a user can read the exact
 * command before authorizing it. Once that decision is made, every downstream
 * consumer — summaries, events, the success result — needs only which
 * identities were involved, so this is what travels.
 */
export interface McpConsentRequestSummary {
  declarations: readonly McpApprovalSummary[]
  takeovers: readonly McpTakeoverSummary[]
}

export function summarizeMcpConsentRequest(request: McpConsentRequest): McpConsentRequestSummary {
  return {
    declarations: request.declarations.map((approval) => ({
      effectiveName: approval.identity.effectiveName,
      claimants: approval.claimants.map((claimant) => claimant.facet),
      standing: approval.standing,
    })),
    takeovers: request.takeovers.map((takeover) => ({
      adapter: takeover.adapter,
      effectiveName: takeover.identity.effectiveName,
      existing: takeover.existing,
    })),
  }
}

/**
 * Whether this run needed approval, and how it got it.
 *
 * `via` distinguishes a decision a human made from one a flag supplied. Both
 * authorize the same work, but only one of them means someone read the
 * commands, which is exactly the distinction an audit of a CI run wants.
 */
export type McpConsentOutcome =
  | { kind: 'not-required' }
  | { kind: 'accepted'; via: 'interactive' | 'preapproved'; request: McpConsentRequestSummary }

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/** A server override the successful commit dropped. */
export interface PrunedServerIntent {
  facet: string
  authoredName: string
}

/** Everything an operation did to MCP configuration, for the success result. */
export interface McpInstallOutcomes {
  consent: McpConsentOutcome
  /** Every authored declaration's disposition and intent change. */
  dispositions: readonly McpDispositionOutcome[]
  /** Per adapter, per effective identity: what reconciliation did. */
  configurations: readonly McpConfigurationOutcome[]
  /** Server overrides this commit pruned because the facet no longer declares them. */
  prunedIntent: readonly PrunedServerIntent[]
}

/** The outcome of an operation that had no MCP work at all. */
export const NO_MCP_OUTCOMES: McpInstallOutcomes = {
  consent: { kind: 'not-required' },
  dispositions: [],
  configurations: [],
  prunedIntent: [],
}
