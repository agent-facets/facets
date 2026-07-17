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
   * Normalize a would-write `(content, metadata)` candidate into the exact
   * shape `readAsset` would return after a real install round-trip.
   *
   * The install pipeline compares this normalized candidate against the
   * current on-disk asset (via `readAsset`) to decide whether a write can
   * be skipped ("skip-if-identical"). If an adapter's on-disk serialization
   * differs from the standard YAML front-matter model — e.g. TOML agents,
   * or metadata keys routed to a sidecar file — it MUST implement this
   * method so the comparison is apples-to-apples. Otherwise every install
   * run re-writes ("repairs") assets that are already in their desired
   * state.
   *
   * Optional: adapters whose round-trip is the standard YAML front-matter
   * split+merge (`installAssetFile`/`readAssetFile`) don't need it — the
   * pipeline falls back to that default (see `normalizeAssetContent`).
   */
  normalizeForCompare?(
    assetType: AssetType,
    content: string,
    metadata: AdapterMetadata,
  ): { content: string; metadata: AdapterMetadata }

  /**
   * Resolve the on-disk path an asset serializes to for the given scope.
   *
   * The install pipeline uses this to detect two DISTINCT assets that
   * collide on a single path — e.g. an adapter (like Codex) that installs
   * both a skill named `plan` and a command named `plan` under the same
   * `.agents/skills/plan/SKILL.md`. Without detection, the second write
   * silently clobbers the first, deleting one asset removes the other's
   * file, and both re-write ("repair") each other forever. When the
   * pipeline sees two assets resolve to the same path it fails loud
   * (`ASSET_PATH_COLLISION`) before any write, rather than corrupting
   * on-disk state.
   *
   * Optional: adapters whose asset types never share a directory tree
   * (claude-code, opencode) don't need it — the pipeline skips the check
   * for adapters that don't implement it. Return a stable, absolute path
   * (two equal-identity assets MUST resolve to equal strings).
   */
  resolvePath?(scope: Scope, assetType: AssetType, name: string): string

  /**
   * Delete an asset from the given scope. Returns the absolute path of
   * the deleted asset, if available — used for verbose diagnostic
   * logging. Returning `void` is backward-compatible.
   */
  deleteAsset(scope: Scope, assetType: AssetType, name: string): Promise<string | undefined>
}

// Re-export common types for convenience — SDK consumers don't need to install common
export type { AssetType, Scope, Validated, ValidationError }
