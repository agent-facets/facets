import type { McpServerDeclaration } from '@agent-facets/protocol/mcp-declaration'

/**
 * The MCP server capability: how an adapter reconciles a project's desired
 * MCP servers into its tool's own native project configuration.
 *
 * The shape of this contract is driven by three requirements that the asset
 * methods do not have to satisfy:
 *
 * 1. **Batch, not per-server.** Every desired server for one project lands in
 *    the same native document. Applying them one at a time would mean one
 *    parse/serialize cycle per server and a window in which the document holds
 *    a partial set.
 * 2. **Plan before mutate.** The engine has to ask "what would this change?"
 *    and show the answer to the user *before* anything is written, so
 *    preparation is strictly read-only and yields a plan the engine holds onto.
 * 3. **No inverse operations.** Rollback is byte-exact restoration performed by
 *    the engine, which journals the preimage of every document `prepare`
 *    disclosed. An adapter is never asked to undo its own edit — undo fidelity
 *    would otherwise depend on adapter code being correct twice, and on a
 *    semantic inverse reproducing comments and formatting it never saw.
 */

/**
 * One desired server: the effective name it must appear under, and the
 * portable declaration to render natively.
 *
 * `name` is already the *effective* name — aliases and collisions are resolved
 * upstream, so an adapter never sees an authored name and never resolves one.
 * The declaration type is imported from the protocol contract rather than
 * restated here, so an adapter's signature cannot drift from the published
 * declaration shape.
 */
export interface McpServerContribution {
  readonly name: string
  readonly declaration: McpServerDeclaration
}

/**
 * The complete desired MCP state for one project, handed to `prepare`.
 *
 * `desired` is exhaustive: a server absent from it is not desired, and
 * `previouslyOwnedNames` is the caller-verified set of effective names a prior
 * successful operation recorded for this adapter. Those two together are what
 * let `prepare` classify occupancy — an entry the document has, the desired set
 * lacks, and this list names is obsolete and owned; an entry no list names is
 * someone else's and is never touched.
 *
 * The adapter must not infer ownership from the document, from a naming
 * convention, or from a marker comment. Ownership arrives on every request and
 * the supplied set is the complete extent of what may be removed.
 */
export interface PrepareMcpServersRequest {
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
 * What preparation found for one server name, and what applying the plan would
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
   * still reported so the engine can drop the ownership record.
   */
  | { readonly kind: 'obsolete-owned'; readonly name: string; readonly occupancy: 'present' | 'absent' }

/**
 * Structured failure data for MCP capability operations.
 *
 * Expected failures are values, not thrown errors — the caller branches on
 * `code`. Adapters convert their internal exceptions into these; anything
 * thrown past this boundary is a programmer bug.
 *
 * There is deliberately no rollback failure code: adapters do not roll back.
 */
export type McpServerCapabilityFailure =
  /** A filesystem operation failed. */
  | {
      readonly code: 'io-failed'
      readonly operation: 'read' | 'write'
      readonly path: string
      readonly message: string
    }
  /** The native document exists but could not be parsed. */
  | { readonly code: 'parse-failed'; readonly path: string; readonly message: string }
  /** The document parsed, but its MCP section is not a shape the adapter can safely edit. */
  | { readonly code: 'validation-failed'; readonly path: string; readonly message: string }
  /** The desired state cannot be represented in this document without destroying native state. */
  | { readonly code: 'conflict'; readonly path: string; readonly message: string }

/**
 * A successful read-only preparation.
 *
 * `documentPaths` is the complete set of native documents applying `plan`
 * could touch, disclosed *before* any mutation so the engine can journal their
 * byte preimages. A path is listed even when the document does not exist yet —
 * "absent" is a preimage the engine can restore to. The list is non-empty:
 * an adapter that reconciles nothing still names the document it inspected.
 *
 * `plan` is opaque. The engine stores it and hands it back to `apply`; it never
 * inspects, serializes, or reorders it, so an adapter may put whatever it likes
 * in there — including the parsed document it already holds, which is what
 * makes `apply` a single write rather than a second parse.
 */
export interface McpServerPreparation<Plan> {
  readonly plan: Plan
  readonly documentPaths: readonly [string, ...string[]]
  readonly outcomes: readonly McpServerPreparationOutcome[]
}

/** Result of `prepare`. On failure, every inspected document is unchanged. */
export type PrepareMcpServersResult<Plan> =
  | { readonly ok: true; readonly preparation: McpServerPreparation<Plan> }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/**
 * Result of `apply`.
 *
 * `unchanged` and `changed` are separate arms rather than a boolean beside an
 * always-present path list, so "nothing was written" cannot be reported
 * alongside a non-empty set of changed paths. Every path in `changedPaths`
 * must have appeared in the preparation's `documentPaths` — the engine cannot
 * restore a document whose preimage it was never given.
 *
 * On failure the affected documents are unchanged; the operation is atomic per
 * document, so a handled write failure never leaves a partial set behind.
 */
export type ApplyMcpServersResult =
  | { readonly ok: true; readonly status: 'unchanged' }
  | { readonly ok: true; readonly status: 'changed'; readonly changedPaths: readonly [string, ...string[]] }
  | { readonly ok: false; readonly failure: McpServerCapabilityFailure }

/**
 * The complete MCP server capability.
 *
 * An adapter either implements both operations or declares `mcpServers: false`.
 * There is no partial state: a capability object missing `apply` is not a
 * capability, and the SDK factory refuses to build one.
 *
 * `Plan` is the adapter's own prepared-plan type. It defaults to `unknown` at
 * the consumer boundary, which is precisely the point — the engine holds a
 * value it structurally cannot read.
 */
export interface McpServerCapability<Plan = unknown> {
  /**
   * Inspect native project configuration and compute the complete desired
   * change. Writes nothing, creates nothing, and runs nothing.
   */
  prepare(request: PrepareMcpServersRequest): Promise<PrepareMcpServersResult<Plan>>

  /**
   * Commit a prepared plan as one atomic update per affected document.
   *
   * Never launches, connects to, health-checks, or authenticates a declared
   * server; materializing configuration is not running it.
   */
  apply(request: { readonly plan: Plan }): Promise<ApplyMcpServersResult>
}

export type { McpServerDeclaration }
