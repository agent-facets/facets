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
 * Classifies the scope for adapter interactions
 */
export type Scope = 'system' | 'user' | 'project'

/**
 * A list that is non-empty by type.
 *
 * Used by result arms whose whole reason for existing is that they carry at
 * least one item — a "some things could not be restored" arm holding nothing
 * is an illegal state, and a runtime length check is not enforcement.
 */
export type NonEmptyArray<T> = readonly [T, ...T[]]

/**
 * Narrow an accumulated list to its non-empty type.
 *
 * A guard rather than a cast, so the one place that decides "there is at least
 * one of these" is a real runtime check the compiler then trusts.
 */
export function isNonEmpty<T>(items: readonly T[]): items is NonEmptyArray<T> {
  return items.length > 0
}
