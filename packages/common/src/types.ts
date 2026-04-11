/**
 * A structured validation error decoupled from any specific validation library.
 * Used across all packages to report schema and parsing failures.
 */
export interface ValidationError {
  /** Dot-separated path to the invalid field (e.g., "agents.reviewer.prompt") */
  path: string
  /** Human-readable error message */
  message: string
  /** What was expected at this location */
  expected: string
  /** What was actually found */
  actual: string
}

/**
 * Discriminated result type for validation operations.
 * Callers check `ok` to determine success or failure.
 *
 * Replaces the previous `Result<T>` (which required a type parameter)
 * and `ValidationResult` (which was `Result<void>`). Every validation
 * operation returns data on success — `T` is always required.
 *
 * @example
 * ```ts
 * const result: Validated<FacetManifest> = loadManifest(dir)
 * if (result.ok) {
 *   console.log(result.data) // FacetManifest
 * } else {
 *   console.error(result.errors) // ValidationError[]
 * }
 * ```
 */
export type Validated<T> = { ok: true; data: T } | { ok: false; errors: ValidationError[] }

/**
 * The canonical asset type — singular form.
 * Code that needs the plural/manifest-key form should derive it.
 */
export type AssetType = 'skill' | 'agent' | 'command'

/**
 * A scoped filesystem location used by harnesses to declare
 * where assets or config files live.
 *
 * - `path`: relative for project scope, absolute for user/system scope
 * - `scope`: classifies the location's ownership level
 * - `type`: discriminates between directories (asset containers) and files (config targets)
 */
export interface Location {
  /** Filesystem path — relative for project scope, absolute for user/system scope */
  path: string
  /** Ownership level of this location */
  scope: 'system' | 'user' | 'project'
  /** Whether this location is a directory (container) or a file (target) */
  type: 'directory' | 'file'
}
