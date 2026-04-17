import type { AssetType, Scope, Validated, ValidationError } from '@agent-facets/common'

/**
 * Opaque record type for harness-specific asset metadata.
 * Each harness defines its own schema — this is the generic container.
 */
export type HarnessMetadata = Record<string, unknown>

/**
 * The full harness contract. Returned by `defineHarness()`.
 *
 * A harness is an AI coding tool (OpenCode, Claude Code, Codex, etc.)
 * that wraps around an LLM. The harness is a full abstraction layer
 * over its tool's storage and configuration.
 */
export interface Harness {
  /** Unique harness name (e.g., "opencode", "claude-code", "codex") */
  readonly name: string

  /**
   * Validate and enrich per-asset harness metadata from a facet manifest.
   * Takes raw metadata, validates it against the harness's schema,
   * applies harness-specific defaults, and returns the enriched object.
   */
  buildAssetMetadata(data: unknown): Validated<HarnessMetadata>

  /** Install an asset at the given scope */
  installAsset(scope: Scope, assetType: AssetType, name: string, content: string, metadata: unknown): Promise<void>

  /** Read an asset's content from the given scope */
  readAsset(scope: Scope, assetType: AssetType, name: string): Promise<{ content: string; metadata?: HarnessMetadata }>

  /** Delete an asset from the given scope */
  deleteAsset(scope: Scope, assetType: AssetType, name: string): Promise<void>
}

// Re-export common types for convenience — SDK consumers don't need to install common
export type { AssetType, Scope, Validated, ValidationError }
