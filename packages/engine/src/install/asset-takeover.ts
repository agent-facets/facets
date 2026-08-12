import type { AssetIdentity } from './types.ts'

/**
 * The just-in-time asset takeover gate.
 *
 * Desired project state authorizes reconciling an effective identity even
 * when something is already sitting there — but "something is already sitting
 * there and this machine did not put it there" is worth saying out loud
 * before it is adopted or replaced.
 *
 * Just-in-time, and deliberately so: the question is asked from the
 * previous-state read that no-op detection and rollback already require, at
 * the moment that identity is reached. Nothing else is inspected. A file at a
 * destination the desired set never names is not looked at, let alone
 * mentioned — searching for takeovers would turn a targeted operation into a
 * survey of the user's project.
 *
 * Entirely separate from MCP configuration consent. Approving a server's
 * command says nothing about overwriting a hand-written skill, and the type
 * system keeps them apart: no MCP value is in scope where this gate runs.
 */

/** One occupied, untracked destination the desired set names. */
export interface AssetTakeoverRequest {
  /** The facet whose desired asset reached this destination. */
  facet: string
  /** The adapter whose storage is occupied — the file lives in ITS tree. */
  adapter: string
  /** The EFFECTIVE identity being taken over. */
  asset: AssetIdentity
  /** The authored name, so an alias reads as "authored → effective". */
  authoredName: string
  /**
   * What is already there, relative to the desired state.
   *
   * Never "absent": an empty destination is a creation, not a takeover, and
   * the gate is not reached for one. `equivalent` is adopted with no write at
   * all; `divergent` is overwritten.
   */
  occupancy: 'equivalent' | 'divergent'
}

/**
 * The answer.
 *
 * Two arms only. "Continue by default" is expressed by the ABSENCE of a
 * resolver rather than a third arm, so a non-interactive run has nothing to
 * answer and "asked but undecided" is not representable.
 */
export type AssetTakeoverDecision = { kind: 'continue' } | { kind: 'cancelled' }

export type AssetTakeoverResolver = (request: AssetTakeoverRequest) => Promise<AssetTakeoverDecision>
