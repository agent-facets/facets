import type { AssetType, Scope, Validated, ValidationError } from '@agent-facets/common'
import type { AdapterApiVersion } from './api-version.ts'

/**
 * Opaque record type for adapter-specific asset metadata.
 * Each adapter defines its own schema — this is the generic container.
 */
export type AdapterMetadata = Record<string, unknown>

/**
 * The full adapter contract. Returned by `defineAdapter()`.
 *
 * An adapter is an AI coding tool (OpenCode, Claude Code, Codex, etc.)
 * that wraps around an LLM. The adapter is a full abstraction layer
 * over its tool's storage and configuration.
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

  /**
   * Install an asset at the given scope. Returns the absolute path the
   * asset was written to, if available — used for verbose diagnostic
   * logging. Returning `void` is backward-compatible (older adapters
   * that don't return a path still satisfy the contract).
   */
  installAsset(
    scope: Scope,
    assetType: AssetType,
    name: string,
    content: string,
    metadata: unknown,
  ): Promise<string | undefined>

  /** Read an asset's content from the given scope */
  readAsset(scope: Scope, assetType: AssetType, name: string): Promise<{ content: string; metadata?: AdapterMetadata }>

  /**
   * Delete an asset from the given scope. Returns the absolute path of
   * the deleted asset, if available — used for verbose diagnostic
   * logging. Returning `void` is backward-compatible.
   */
  deleteAsset(scope: Scope, assetType: AssetType, name: string): Promise<string | undefined>
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
