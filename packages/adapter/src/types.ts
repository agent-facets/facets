import type { AssetType, Scope, Validated, ValidationError } from '@agent-facets/common'
import type { AdapterApiVersion } from './api-version.ts'

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
 * Install request, tagged by asset type.
 *
 * The skill variant is the only one that can carry companion files:
 * `companions` is the complete new bundle beyond `SKILL.md`, and
 * `ownedCompanionPaths` is the caller-verified set of companion paths a
 * previous install owned, taken from the caller's own record of what it
 * materialized — never from shared, version-controlled project state.
 * Replacement removes exactly the owned paths absent from the new bundle;
 * unowned files are never touched. Adapters never persist ownership or
 * infer it from disk — ownership data arrives on every request.
 *
 * Agent and command variants structurally cannot carry companions or
 * ownership sets, and no variant exists for archive-only supplementary
 * files (they never reach adapters).
 */
export type InstallAssetRequest =
  | {
      readonly assetType: 'skill'
      readonly scope: Scope
      readonly name: string
      /** Primary `SKILL.md` text (front-matter transformation applies here only). */
      readonly content: string
      readonly metadata: unknown
      /** New companion bundle, paths relative to the skill root. `{}` is legal. */
      readonly companions: CompanionMap
      /** Caller-verified previously-owned companion paths. `[]` is legal. */
      readonly ownedCompanionPaths: readonly string[]
    }
  | {
      readonly assetType: 'agent'
      readonly scope: Scope
      readonly name: string
      readonly content: string
      readonly metadata: unknown
    }
  | {
      readonly assetType: 'command'
      readonly scope: Scope
      readonly name: string
      readonly content: string
      readonly metadata: unknown
    }

/**
 * Read request, tagged by asset type.
 *
 * A skill read carries the caller-verified owned companion path set to
 * return. The adapter must not enumerate the skill directory — it reads
 * exactly the requested owned paths, so unowned files can never be swept
 * into a read result.
 */
export type ReadAssetRequest =
  | {
      readonly assetType: 'skill'
      readonly scope: Scope
      readonly name: string
      /** Owned companion paths whose bytes should be returned. `[]` is legal. */
      readonly ownedCompanionPaths: readonly string[]
    }
  | { readonly assetType: 'agent'; readonly scope: Scope; readonly name: string }
  | { readonly assetType: 'command'; readonly scope: Scope; readonly name: string }

/**
 * Delete request, tagged by asset type.
 *
 * A skill delete carries the caller-verified owned companion path set;
 * the adapter removes the primary plus exactly those paths as one atomic
 * operation, preserving every other file and pruning only directories
 * left empty by owned-file removal.
 */
export type DeleteAssetRequest =
  | {
      readonly assetType: 'skill'
      readonly scope: Scope
      readonly name: string
      /** Owned companion paths to delete alongside the primary. `[]` is legal. */
      readonly ownedCompanionPaths: readonly string[]
    }
  | { readonly assetType: 'agent'; readonly scope: Scope; readonly name: string }
  | { readonly assetType: 'command'; readonly scope: Scope; readonly name: string }

/**
 * Structured failure data for adapter asset operations.
 *
 * Expected failures are values, not thrown errors — the caller branches
 * on `code`. Adapters convert their internal I/O exceptions into
 * `io-failed`; anything thrown past this boundary is a programmer bug.
 */
export type AdapterAssetFailure =
  /** The requested asset does not exist at that scope. */
  | { readonly code: 'not-found' }
  /**
   * A supplied companion path (new or owned) is malformed or escapes the
   * skill root. Detected before any filesystem access; the whole request
   * is rejected without reading, writing, or deleting anything.
   */
  | { readonly code: 'invalid-companion-path'; readonly path: string; readonly reason: string }
  /** The adapter does not support the requested scope. */
  | { readonly code: 'unsupported-scope'; readonly scope: Scope }
  /** The adapter does not implement this operation. */
  | { readonly code: 'not-implemented'; readonly method: 'installAsset' | 'readAsset' | 'deleteAsset' }
  /** A filesystem operation failed. `operation: 'rollback'` means the
   * failure occurred while restoring the prior bundle after another
   * failure — the bundle may be partial and needs re-install to converge. */
  | {
      readonly code: 'io-failed'
      readonly operation: 'read' | 'write' | 'delete' | 'rollback'
      readonly path?: string
      readonly message: string
    }

/** Result of an install operation. */
export type InstallAssetResult =
  | {
      readonly ok: true
      /** Absolute path of the written primary file — used for verbose logging. */
      readonly primaryPath: string
    }
  | { readonly ok: false; readonly failure: AdapterAssetFailure }

/**
 * A successfully read asset, tagged by type. The skill variant carries the
 * bytes of exactly the owned companion paths that were requested and exist.
 * `content` is canonical logical primary content: adapter-specific storage
 * encoding (front-matter wrapping, TOML fields, …) is stripped so callers
 * can compare it with portable integrity records.
 */
export type ReadAsset =
  | {
      readonly assetType: 'skill'
      readonly content: string
      readonly metadata?: AdapterMetadata
      readonly companions: CompanionMap
    }
  | { readonly assetType: 'agent'; readonly content: string; readonly metadata?: AdapterMetadata }
  | { readonly assetType: 'command'; readonly content: string; readonly metadata?: AdapterMetadata }

/** Result of a read operation. */
export type ReadAssetResult =
  | { readonly ok: true; readonly asset: ReadAsset }
  | { readonly ok: false; readonly failure: AdapterAssetFailure }

/** Result of a delete operation. */
export type DeleteAssetResult =
  | {
      readonly ok: true
      /** False when the asset did not exist (delete is idempotent — that is success). */
      readonly existed: boolean
      /** Absolute paths of every file removed — used for verbose logging. */
      readonly deletedPaths: readonly string[]
    }
  | { readonly ok: false; readonly failure: AdapterAssetFailure }

/**
 * The full adapter contract. Returned by `defineAdapter()`.
 *
 * An adapter is an AI coding tool (OpenCode, Claude Code, Codex, etc.)
 * that wraps around an LLM. The adapter is a full abstraction layer
 * over its tool's storage and configuration.
 *
 * All three asset operations take tagged requests and return tagged
 * results. A skill install is one all-or-nothing operation over the
 * complete bundle: the new primary and companions all commit (with
 * previously-owned paths absent from the new bundle removed), or the
 * prior bundle remains intact. Recovery from an interrupted process is
 * the caller's idempotent re-install, so operations must be convergent.
 */
export interface Adapter {
  /** Unique adapter name (e.g., "opencode", "claude-code", "codex") */
  readonly name: string

  /**
   * The adapter API contract identifier this adapter implements.
   *
   * Stamped by `defineAdapter()` from the SDK's canonical
   * `ADAPTER_API_VERSION` — adapter authors do not (and cannot) supply
   * it; the factory's input type (`AdapterDefinition`) excludes it.
   */
  readonly apiVersion: AdapterApiVersion

  /**
   * When true, this adapter exposes real filesystem I/O (installAsset,
   * readAsset, deleteAsset) and is selectable in the install picker.
   * Absent or false: adapter is hidden from picker (users cannot
   * materialize facets via this adapter). Set to true only when all
   * three I/O methods are implemented and tested.
   */
  readonly supportsInstall?: boolean

  /**
   * Validate and enrich per-asset adapter metadata from a facet manifest.
   * Takes raw metadata, validates it against the adapter's schema,
   * applies adapter-specific defaults, and returns the enriched object.
   */
  buildAssetMetadata(data: unknown): Validated<AdapterMetadata>

  /** Install (or replace) an asset. See {@link InstallAssetRequest}. */
  installAsset(request: InstallAssetRequest): Promise<InstallAssetResult>

  /** Read an asset's canonical content. See {@link ReadAssetRequest}. */
  readAsset(request: ReadAssetRequest): Promise<ReadAssetResult>

  /** Delete an asset. See {@link DeleteAssetRequest}. */
  deleteAsset(request: DeleteAssetRequest): Promise<DeleteAssetResult>
}

/**
 * The author-facing definition accepted by `defineAdapter()`.
 *
 * Identical to `Adapter` except the SDK-owned `apiVersion` field is
 * excluded — the factory stamps the canonical value, so an author cannot
 * declare a conflicting API identifier.
 */
export type AdapterDefinition = Omit<Adapter, 'apiVersion'>

// Re-export common types for convenience — SDK consumers don't need to install common
export type { AssetType, Scope, Validated, ValidationError }
