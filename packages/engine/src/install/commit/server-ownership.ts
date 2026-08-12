import {
  compareCodeUnits,
  type McpServerFingerprint,
  type McpServerIdentity,
  materializedNameOf,
  mcpServerKey,
  type PlannedServerConfiguration,
} from '@agent-facets/protocol'
import { ownRecord } from '../own-entry.ts'
import type { ProjectReceiptState, ReceiptConfigurationClaim } from '../receipt.ts'

/**
 * The MCP configuration ownership index: which effective server identities
 * this machine has reconciled, and what it approved at each one.
 *
 * A sibling of the asset ownership index rather than a widening of it. The
 * two answer the same two questions — "may this be deleted?" and "which
 * facets claimed it?" — but over different identity spaces, with different
 * keys, and with one extra question that only applies here: "was this exact
 * declaration already approved on this machine?"
 *
 * Ownership is project-wide and adapter-agnostic, exactly as it is for
 * assets. Selecting an adapter delegates management of the identities the
 * project already owns; it does not create a second ownership axis, and the
 * key deliberately carries no adapter.
 */

/** One effective MCP identity this machine previously reconciled. */
export interface PreviousMcpOwnership {
  identity: McpServerIdentity
  /** The addressable ownership key for {@link identity}. */
  key: string
  /** The name an adapter can address this configuration by. */
  effectiveName: string
  /** Every facet that claimed this identity. Sorted; usually one. */
  facets: readonly string[]
  /**
   * Every declaration fingerprint recorded at this identity. Sorted; usually
   * one.
   *
   * More than one means the receipt recorded claims that disagreed about what
   * the server IS — historical claims from separate facets, which composition
   * would now contest. All of them are kept: each is evidence that THAT
   * declaration was approved here, and discarding any would silently
   * re-prompt for something the user already accepted.
   */
  fingerprints: readonly McpServerFingerprint[]
}

/** Fold one claim into the index, unioning claimants and fingerprints. */
function addClaim(index: Map<string, PreviousMcpOwnership>, facet: string, claim: ReceiptConfigurationClaim): void {
  const effectiveName = materializedNameOf(claim.name, claim.materialization)
  const key = mcpServerKey(effectiveName)
  const existing = index.get(key)
  if (existing === undefined) {
    index.set(key, {
      identity: { kind: 'mcp-server', effectiveName },
      key,
      effectiveName,
      facets: [facet],
      fingerprints: [claim.fingerprint],
    })
    return
  }
  index.set(key, {
    ...existing,
    facets: existing.facets.includes(facet) ? existing.facets : [...existing.facets, facet].sort(compareCodeUnits),
    fingerprints: existing.fingerprints.includes(claim.fingerprint)
      ? existing.fingerprints
      : [...existing.fingerprints, claim.fingerprint].sort(compareCodeUnits),
  })
}

/**
 * Build the global MCP configuration ownership index.
 *
 * Takes the receipt STATE, like its asset counterpart, so "no usable account"
 * and "an account that happens to be empty" cannot be confused at the call
 * site. A receipt that predates configuration claims yields an EMPTY index —
 * not because it owns nothing, but because it cannot say. Empty is the safe
 * answer in both directions: nothing is deleted, and every declaration is
 * treated as needing approval.
 */
export function buildPreviousMcpOwnership(state: ProjectReceiptState): Map<string, PreviousMcpOwnership> {
  const index = new Map<string, PreviousMcpOwnership>()
  if (state.kind !== 'loaded') return index
  if (state.record.authority !== 'assets-and-configuration') return index

  for (const [facet, entry] of Object.entries(state.record.facets)) {
    for (const claim of entry.configurations) {
      addClaim(index, facet, claim)
    }
  }
  return index
}

/**
 * The effective server identities to remove: previously reconciled per the
 * receipt, claimed by nothing in the desired set.
 *
 * The desired set is the authority for what should exist; this index is the
 * only authority for what may be removed. An identity the lockfile once
 * implied but the receipt never recorded is untracked, and stays untouched.
 *
 * Deterministically ordered by key so a rollback replays in a stable sequence
 * and verbose output is reviewable.
 */
export function obsoleteMcpOwnership(
  previous: ReadonlyMap<string, PreviousMcpOwnership>,
  // Only the key is read, and only the key can be: the removal path proves
  // what remains from carried receipt claims, which carry no declaration
  // because no fetch happened. Demanding a `PlannedServerConfiguration` there
  // would force it to invent one.
  desired: readonly { readonly key: string }[],
): PreviousMcpOwnership[] {
  const claimed = new Set(desired.map((configuration) => configuration.key))
  const obsolete: PreviousMcpOwnership[] = []
  for (const [key, ownership] of previous) {
    if (claimed.has(key)) continue
    obsolete.push(ownership)
  }
  obsolete.sort((a, b) => compareCodeUnits(a.key, b.key))
  return obsolete
}

/**
 * The effective names an adapter may treat as already owned by this project.
 *
 * This is the complete extent of what an adapter is permitted to remove, and
 * it comes from the receipt alone. Deriving it from the lockfile would let a
 * teammate's commit authorize deleting an entry this machine never wrote.
 */
export function previouslyOwnedServerNames(previous: ReadonlyMap<string, PreviousMcpOwnership>): string[] {
  return [...previous.values()].map((ownership) => ownership.effectiveName).sort(compareCodeUnits)
}

/**
 * Whether this machine already approved this exact declaration at this exact
 * effective identity.
 *
 * Keyed on identity AND fingerprint, because either changing is a different
 * thing to consent to: a new effective name puts a previously approved
 * command somewhere new, and a new fingerprint runs something else under a
 * name that was already trusted.
 */
export function isDeclarationApproved(
  previous: ReadonlyMap<string, PreviousMcpOwnership>,
  configuration: PlannedServerConfiguration,
): boolean {
  return previous.get(configuration.key)?.fingerprints.includes(configuration.fingerprint) ?? false
}

/**
 * The receipt claims a set of reconciled configurations implies, keyed by
 * claimant facet.
 *
 * Every claimant records its own claim, under its OWN authored name and
 * disposition: ownership is per project, but a claim has to be attributable
 * to a facet so that removing one claimant while another remains preserves
 * the configuration. The effective identity all of them derive is the same,
 * which is what makes the ownership index above fold them back together.
 *
 * Omitted declarations cannot appear: a configuration exists only for an
 * ACTIVE identity, and a claimant's disposition admits only the arms that
 * materialize.
 */
export function claimsByFacet(
  configurations: readonly PlannedServerConfiguration[],
): Record<string, ReceiptConfigurationClaim[]> {
  // Null-prototype: keyed by facet name from `facets.json`, where
  // `__proto__` is a legal key and a silent drop would lose a claim.
  const byFacet: Record<string, ReceiptConfigurationClaim[]> = ownRecord()
  for (const configuration of configurations) {
    for (const claimant of configuration.claimants) {
      const claims = byFacet[claimant.facet] ?? []
      claims.push({
        kind: 'mcp-server',
        name: claimant.authoredName,
        materialization: claimant.disposition,
        fingerprint: configuration.fingerprint,
      })
      byFacet[claimant.facet] = claims
    }
  }
  return byFacet
}
