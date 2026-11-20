import type { AssetType, FileMutationAction, FileState, Scope, Validated, ValidationError } from '@agent-facets/common'
import type { AdapterApiVersion } from './api-version.ts'
import type { McpServerCapability } from './mcp-servers.ts'
import type { CapabilityDeclarations, PlanningContext, PlanningContextFailure } from './planning-context.ts'

/**
 * Opaque record type for adapter-specific asset metadata.
 * Each adapter defines its own schema — this is the generic container.
 */
export type AdapterMetadata = Record<string, unknown>

/**
 * Canonical map of skill companion paths to opaque bytes.
 *
 * Keys are paths **relative to the skill root** (e.g. `references/api.md`),
 * using forward slashes. Values are exact bytes, stored verbatim — no
 * front-matter or metadata transformation ever applies to companions.
 * An empty map is legal and is how a companion-less skill is expressed.
 */
export type CompanionMap = Record<string, Uint8Array>

/**
 * A batch of file mutations plus the outcome they realize.
 *
 * `unchanged` is a first-class answer rather than an empty batch, so "already
 * correct" and "needs these writes" can never be confused for one another.
 */
export type MutateAction = Extract<FileMutationAction, { kind: 'mutate' }>

/**
 * What every asset request carries besides its content: the explicit target
 * and the location inputs to resolve it with.
 *
 * The context is the ONLY definition of "this project" or "this user" an
 * adapter may use. See {@link PlanningContext}.
 */
export interface AssetRequestBase {
  readonly context: PlanningContext
}

/**
 * Install/reconcile planning request, tagged by asset type.
 *
 * The skill variant is the only one that can carry companion files:
 * `companions` is the complete new bundle beyond `SKILL.md`, and
 * `ownedCompanionPaths` is the caller-verified set of companion paths a
 * previous install owned, taken from the caller's own record of what it
 * materialized — never from shared, version-controlled project state.
 * The plan removes exactly the owned paths absent from the new bundle;
 * unowned files are never touched. Adapters never persist ownership, never
 * infer it from disk, and never enumerate a directory to discover it —
 * ownership data arrives on every request, and the supplied set is the
 * complete extent of what may be removed.
 */
export type PlanAssetInstallRequest = AssetRequestBase &
  (
    | {
        readonly assetType: 'skill'
        readonly name: string
        /** Primary `SKILL.md` text (front-matter transformation applies here only). */
        readonly content: string
        readonly metadata: unknown
        /** New companion bundle, paths relative to the skill root. `{}` is legal. */
        readonly companions: CompanionMap
        /** Caller-verified previously-owned companion paths. `[]` is legal. */
        readonly ownedCompanionPaths: readonly string[]
      }
    | { readonly assetType: 'agent'; readonly name: string; readonly content: string; readonly metadata: unknown }
    | { readonly assetType: 'command'; readonly name: string; readonly content: string; readonly metadata: unknown }
  )

/** Removal planning request, tagged by asset type. */
export type PlanAssetRemovalRequest = AssetRequestBase &
  (
    | {
        readonly assetType: 'skill'
        readonly name: string
        /** Owned companion paths to remove alongside the primary. `[]` is legal. */
        readonly ownedCompanionPaths: readonly string[]
      }
    | { readonly assetType: 'agent'; readonly name: string }
    | { readonly assetType: 'command'; readonly name: string }
  )

/**
 * What the planner found where the asset belongs.
 *
 * This is the caller's takeover input: adopting a file that already holds
 * equivalent content is still adopting a file somebody else may have written,
 * so `equivalent` has to be distinguishable from `absent` even though neither
 * produces a divergent write.
 */
export type AssetOccupancy = 'absent' | 'equivalent' | 'divergent'

/**
 * A planned install.
 *
 * `equivalent` is bound to `unchanged` and the other two to `mutate`, so an
 * outcome can never contradict the work it claims. An adapter that cannot
 * *prove* equivalence reports `divergent`; guessing would silently keep
 * content that differs from what the user approved.
 *
 * Every arm discloses `storageRoot`: the absolute root this adapter resolved
 * for the request's target, location inputs, and asset type. It is the same
 * for every asset of that type regardless of name, every planned change and
 * authorized directory lies at or below it, and an `equivalent` plan still
 * names it — a plan that changes nothing must still say where it looked, or a
 * caller could not tell that the location moved. Disclosure confers no
 * ownership of anything below it.
 */
export type AssetInstallPlan =
  | {
      readonly occupancy: 'equivalent'
      readonly action: { readonly kind: 'unchanged' }
      /** Absolute path of the primary file — used for verbose reporting. */
      readonly primaryPath: string
      readonly storageRoot: string
    }
  | {
      readonly occupancy: 'absent' | 'divergent'
      readonly action: MutateAction
      readonly primaryPath: string
      readonly storageRoot: string
    }

/**
 * A planned removal.
 *
 * `absent` is not a failure: removing something already gone is success, and
 * a plan that expressed it as an empty batch would be indistinguishable from
 * an adapter that forgot to plan anything. Both arms disclose `storageRoot`
 * exactly as {@link AssetInstallPlan} does.
 */
export type AssetRemovalPlan =
  | { readonly kind: 'absent'; readonly primaryPath: string; readonly storageRoot: string }
  | {
      readonly kind: 'remove'
      readonly action: MutateAction
      readonly primaryPath: string
      readonly storageRoot: string
    }

/**
 * Structured failure data for adapter planning.
 *
 * Planning is read-only, so there is no write, delete, or rollback failure to
 * report — and deliberately no `not-implemented`: an adapter states whether it
 * has an asset capability at all, rather than accepting a request it will
 * refuse.
 */
export type AdapterPlanFailure =
  /**
   * A supplied companion path (new or owned) is malformed or escapes the
   * skill root. Detected before any filesystem access; the whole request is
   * rejected without reading anything.
   */
  | { readonly code: 'invalid-companion-path'; readonly path: string; readonly reason: string }
  /**
   * The planning context names an unsupported scope or is malformed. Detected
   * before any filesystem access.
   */
  | PlanningContextFailure
  /** The asset name is not safe to join onto a filesystem path. Detected before any filesystem access. */
  | { readonly code: 'invalid-asset-name'; readonly name: string; readonly reason: string }
  /**
   * A planned path or authorized directory does not lie below the storage
   * root the plan would disclose, so the disclosure would be false.
   */
  | {
      readonly code: 'invalid-storage-root'
      readonly storageRoot: string
      readonly path: string
      readonly reason: string
    }
  /** A file could not be read while establishing the current state. */
  | { readonly code: 'io-failed'; readonly path: string; readonly message: string }
  /**
   * Something that is not a plain file occupies a path the plan would target,
   * so no exact state — and therefore no restorable transition — exists for it.
   */
  | { readonly code: 'unsupported-object'; readonly path: string; readonly detail: string }
  /** The adapter's storage format cannot represent the requested content. */
  | { readonly code: 'unrepresentable'; readonly path: string; readonly detail: string }

export type PlanAssetInstallResult =
  | { readonly ok: true; readonly plan: AssetInstallPlan }
  | { readonly ok: false; readonly failure: AdapterPlanFailure }

export type PlanAssetRemovalResult =
  | { readonly ok: true; readonly plan: AssetRemovalPlan }
  | { readonly ok: false; readonly failure: AdapterPlanFailure }

/**
 * How an adapter materializes text assets.
 *
 * One capability object rather than three optional methods beside a
 * `supportsInstall` boolean: that shape could state support and then be
 * missing the method that provides it. `false` means this adapter validates
 * manifest metadata but materializes nothing.
 *
 * Both operations are strictly read-only. They inspect, decide, and return
 * exact per-file transitions; the caller performs every write, journals both
 * endpoints, and owns rollback. An adapter is never asked to undo its own
 * work, so undo fidelity no longer depends on adapter code being correct
 * twice — or on a semantic inverse reproducing formatting it never saw.
 *
 * The declarations state which installation scopes the capability serves and
 * which environment variables it reads to resolve locations. A caller checks
 * them before it plans, and `defineAdapter` refuses a request outside them
 * before the planner is ever called.
 */
export interface AssetCapability extends CapabilityDeclarations {
  planInstall(request: PlanAssetInstallRequest): Promise<PlanAssetInstallResult>
  planRemoval(request: PlanAssetRemovalRequest): Promise<PlanAssetRemovalResult>
}

/**
 * The full adapter contract. Returned by `defineAdapter()`.
 *
 * An adapter is an AI coding tool (OpenCode, Claude Code, Codex, …) that wraps
 * around an LLM. The adapter is a full abstraction layer over its tool's
 * storage and configuration: it owns path resolution, scope handling,
 * containment rules, storage format, metadata rendering, and deciding which
 * owned files are obsolete. It does not own writing.
 */
export interface Adapter {
  /**
   * The adapter SDK API contract identifier this adapter implements.
   *
   * Stamped by `defineAdapter()` from the SDK's canonical
   * `ADAPTER_API_VERSION` — adapter authors do not (and cannot) supply it.
   */
  readonly apiVersion: AdapterApiVersion

  /** Unique adapter name (e.g., "opencode", "claude-code", "codex"). */
  readonly name: string

  /** Whether this adapter materializes text assets, and how. */
  readonly assets: false | AssetCapability

  /**
   * Whether this adapter can reconcile MCP servers into its tool's native
   * project or user configuration, and if so, how.
   *
   * `false` is an explicit, unambiguous "this tool has no MCP configuration I
   * can write" — not "not implemented yet" — and the CLI reports it as such
   * when a project actually has servers.
   */
  readonly mcpServers: false | McpServerCapability

  /**
   * Validate and enrich per-asset adapter metadata from a facet manifest.
   * Takes raw metadata, validates it against the adapter's schema, applies
   * adapter-specific defaults, and returns the enriched object.
   */
  buildAssetMetadata(data: unknown): Validated<AdapterMetadata>
}

/**
 * The author-facing definition accepted by `defineAdapter()`.
 *
 * Identical to the adapter contract except the SDK-owned `apiVersion` field is
 * excluded — the factory stamps the canonical value, so an author cannot
 * declare a conflicting API identifier.
 */
export type AdapterDefinition = Omit<Adapter, 'apiVersion'>

// Re-export common types for convenience — SDK consumers don't need to install common
export type { AssetType, FileMutationAction, FileState, Scope, Validated, ValidationError }
