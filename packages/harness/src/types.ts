import type { AssetType, Location, Validated, ValidationError } from '@agent-facets/common'

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

  /** Ordered array of asset storage locations (highest precedence first) */
  readonly assetLocations: readonly Location[]

  /** Ordered array of config file locations (highest precedence first) */
  readonly configLocations: readonly Location[]

  /**
   * Validate and enrich per-asset harness metadata from a facet manifest.
   * Takes raw metadata, validates it against the harness's schema,
   * applies harness-specific defaults, and returns the enriched object.
   */
  buildAssetMetadata(data: unknown): Validated<HarnessMetadata>

  /** Create an asset at the given location */
  createAsset(location: Location, assetType: AssetType, name: string, content: string, metadata: unknown): Promise<void>

  /** Read an asset's content from the given location */
  readAsset(location: Location, assetType: AssetType, name: string): Promise<string>

  /** Update an existing asset at the given location */
  updateAsset(location: Location, assetType: AssetType, name: string, content: string, metadata: unknown): Promise<void>

  /** Delete an asset from the given location */
  deleteAsset(location: Location, assetType: AssetType, name: string): Promise<void>
}

/**
 * Input to `defineHarness()`. Authors provide this definition object.
 * Optional methods receive stub defaults from the factory.
 */
export interface HarnessDefinition {
  /** Unique harness name */
  name: string

  /** Ordered array of asset storage locations (highest precedence first) */
  assetLocations: Location[]

  /** Ordered array of config file locations (highest precedence first) */
  configLocations: Location[]

  /**
   * Validate and enrich per-asset harness metadata.
   * This is required — every harness must define its metadata schema.
   */
  buildAssetMetadata(data: unknown): Validated<HarnessMetadata>

  /** Create an asset at the given location (optional — stub provided by default) */
  createAsset?(
    location: Location,
    assetType: AssetType,
    name: string,
    content: string,
    metadata: unknown,
  ): Promise<void>

  /** Read an asset's content (optional — stub provided by default) */
  readAsset?(location: Location, assetType: AssetType, name: string): Promise<string>

  /** Update an existing asset (optional — stub provided by default) */
  updateAsset?(
    location: Location,
    assetType: AssetType,
    name: string,
    content: string,
    metadata: unknown,
  ): Promise<void>

  /** Delete an asset (optional — stub provided by default) */
  deleteAsset?(location: Location, assetType: AssetType, name: string): Promise<void>
}

// Re-export common types for convenience — SDK consumers don't need to install common
export type { AssetType, Location, Validated, ValidationError }
