import type { AssetType, Scope, Validated, ValidationError } from '@agent-facets/common'

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
   * Validate and enrich per-asset adapter metadata from a facet manifest.
   * Takes raw metadata, validates it against the adapter's schema,
   * applies adapter-specific defaults, and returns the enriched object.
   */
  buildAssetMetadata(data: unknown): Validated<AdapterMetadata>

  /** Install an asset at the given scope */
  installAsset(scope: Scope, assetType: AssetType, name: string, content: string, metadata: unknown): Promise<void>

  /** Read an asset's content from the given scope */
  readAsset(scope: Scope, assetType: AssetType, name: string): Promise<{ content: string; metadata?: AdapterMetadata }>

  /** Delete an asset from the given scope */
  deleteAsset(scope: Scope, assetType: AssetType, name: string): Promise<void>
}

// Re-export common types for convenience — SDK consumers don't need to install common
export type { AssetType, Scope, Validated, ValidationError }
