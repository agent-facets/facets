import type { FileMutationAction } from '@agent-facets/common'
import type { McpServerDeclaration, ReadonlyMcpServerDeclaration } from '@agent-facets/protocol/mcp-declaration'

/**
 * The MCP server capability: how an adapter reconciles a project's desired
 * MCP servers into its tool's own native project configuration.
 *
 * The shape of this contract is driven by three requirements:
 *
 * 1. **Batch, not per-server.** Every desired server for one project lands in
 *    the same native document. Applying them one at a time would mean one
 *    parse/serialize cycle per server and a window in which the document holds
 *    a partial set.
 * 2. **Plan, never mutate.** The adapter inspects, computes the whole change,
 *    and returns exact per-file transitions. The caller shows them to the user
 *    if approval is needed, performs the writes, and journals both endpoints.
 * 3. **No inverse operations.** Rollback is byte-exact restoration performed by
 *    the caller, which recorded the precise prior bytes of every document it
 *    wrote. An adapter is never asked to undo its own edit — undo fidelity
 *    would otherwise depend on adapter code being correct twice, and on a
 *    semantic inverse reproducing comments and formatting it never saw.
 */

/**
 * One desired server: the effective name it must appear under, and the
 * portable declaration to render natively.
 *
 * `name` is already the *effective* name — aliases and collisions are resolved
 * upstream, so an adapter never sees an authored name and never resolves one.
 *
 * The declaration is deeply read-only. It is the caller's planned declaration,
 * shared with the fingerprint that proves approval of it; an adapter that could
 * edit it in place would change what the user approved after they approved it.
 */
export interface McpServerContribution {
  readonly name: string
  readonly declaration: ReadonlyMcpServerDeclaration
}

/**
 * The complete desired MCP state for one project, handed to `plan`.
 *
 * `desired` is exhaustive: a server absent from it is not desired, and
 * `previouslyOwnedNames` is the caller-verified set of effective names a prior
 * successful operation recorded for this adapter. Those two together are what
 * let planning classify occupancy — an entry the document has, the desired set
 * lacks, and this list names is obsolete and owned; an entry no list names is
 * someone else's and is never touched.
 *
 * The adapter must not infer ownership from the document, from a naming
 * convention, or from a marker comment.
 */
export interface PlanMcpServersRequest {
  readonly projectRoot: string
  readonly desired: readonly McpServerContribution[]
  readonly previouslyOwnedNames: readonly string[]
}

/**
 * Whether the effective identity an outcome describes is already covered by
 * machine-local ownership.
 *
 * `untracked` is the case that requires user consent before the entry is
 * adopted or replaced, so it must be distinguishable from `tracked` even when
 * the resulting write is identical.
 */
export type McpServerOwnership = 'tracked' | 'untracked'

/**
 * What planning found for one server name, and what applying the plan would
 * therefore do to it.
 *
 * The three desired-state arms are distinguished because they drive different
 * user-visible outcomes, not because they need different writes: `equivalent`
 * is adopted with no write at all, `divergent` overwrites content the user may
 * care about, and `absent` is a pure addition.
 */
export type McpServerPreparationOutcome =
  /** No entry exists under this name; applying the plan creates it. */
  | { readonly kind: 'absent'; readonly name: string; readonly ownership: McpServerOwnership }
  /**
   * An entry exists and the adapter proved it is semantically equal to the
   * native rendering of the desired declaration. Applying the plan writes
   * nothing for this entry. An adapter that cannot *prove* equality reports
   * `divergent` instead — unprovable equality fails safe.
   */
  | { readonly kind: 'equivalent'; readonly name: string; readonly ownership: McpServerOwnership }
  /** An entry exists whose behavior differs; applying the plan replaces it. */
  | { readonly kind: 'divergent'; readonly name: string; readonly ownership: McpServerOwnership }
  /**
   * An owned entry the desired set no longer names; applying the plan removes
   * it. `occupancy` is `absent` when the entry is already gone — the claim is
   * still reported so the caller can drop the ownership record.
   */
  | { readonly kind: 'obsolete-owned'; readonly name: string; readonly occupancy: 'present' | 'absent' }

/**
 * Structured failure data for MCP capability planning.
 *
 * Expected failures are values, not thrown errors — the caller branches on
 * `code`. Adapters convert their internal exceptions into these; anything
 * thrown past this boundary is a programmer bug.
 *
 * There is deliberately no write or rollback failure code: adapters neither
 * write nor roll back.
 */
export type McpServerCapabilityFailure =
  /** A document could not be read while establishing its current state. */
  | { readonly code: 'io-failed'; readonly path: string; readonly message: string }
  /** The native document exists but could not be parsed. */
  | { readonly code: 'parse-failed'; readonly path: string; readonly message: string }
  /** The document parsed, but its MCP section is not a shape the adapter can safely edit. */
  | { readonly code: 'validation-failed'; readonly path: string; readonly message: string }
  | McpConflictFailure

/**
 * The desired state cannot be written, for one of two unrelated reasons.
 *
 * Split by `reason` rather than carried as one arm with a path and a sentence,
 * because the two do not share their facts. An interpolation conflict is about
 * a declaration and has no document; only a native-format refusal has something
 * to add that the SDK cannot regenerate.
 *
 * A document changed by another process between planning and writing is NOT
 * here: the caller re-checks every exact prior state immediately before it
 * writes, so concurrency is detected once, in one place, for every kind of file
 * this system touches.
 */
export type McpConflictFailure =
  /**
   * An authored literal contains syntax the target tool would expand rather
   * than use literally, so it cannot be written faithfully anywhere.
   */
  | {
      readonly code: 'conflict'
      readonly reason: 'interpolation'
      readonly serverName: string
      /** The offending value exactly as authored, unescaped and unredacted. */
      readonly value: string
    }
  /** The native format cannot represent the change without destroying native state. */
  | {
      readonly code: 'conflict'
      readonly reason: 'native-state'
      readonly path: string
      /** What the adapter's own format layer reported. */
      readonly detail: string
    }

/**
 * A successful read-only plan.
 *
 * `action` carries the exact per-file transitions applying this plan performs.
 * There is no separate document disclosure list: a document the plan does not
 * mutate is not journaled and not restored, precisely because nothing this run
 * does can change it. Inspecting a file has never been a reason to own it.
 */
export interface McpServersPlan {
  readonly outcomes: readonly McpServerPreparationOutcome[]
  readonly action: FileMutationAction
}

/** Result of `plan`. On failure, every inspected document is unchanged. */
export type PlanMcpServersResult =
  | { readonly ok: true; readonly plan: McpServersPlan }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/**
 * The complete MCP server capability.
 *
 * One operation, because there is nothing left for a second one to do: the
 * caller owns writing, so "prepare" and "apply" collapsed into planning.
 *
 * Planning never launches, connects to, health-checks, or authenticates a
 * declared server; materializing configuration is not running it.
 */
export interface McpServerCapability {
  plan(request: PlanMcpServersRequest): Promise<PlanMcpServersResult>
}

export type { McpServerDeclaration, ReadonlyMcpServerDeclaration }
