/**
 * Tagged-union types for facet sources and version specifiers.
 *
 * These types model the full surface of what a user can write as a
 * facet source. Every value that flows through the install pipeline —
 * from CLI argument to manifest entry to lockfile entry — descends
 * from one of these unions.
 *
 * Design rule: NO optional discriminators. Every variant has its own
 * required-field set. Illegal combinations are unrepresentable.
 */

/**
 * A facet source. One of three variants:
 *
 * - `registry`: a published facet (e.g., `viper-plans@1.2.3`)
 * - `git`: a git repository (https URL, ssh URL, github shorthand, SCP form)
 * - `local`: a local filesystem path
 */
export type Source =
  | { kind: 'registry'; name: string; version: VersionSpec }
  | { kind: 'git'; url: string; ref: string | null }
  | { kind: 'local'; path: string }

/**
 * A version specifier for a registry source. One of five variants:
 *
 * - `exact`: a fully-pinned semver (e.g., `1.2.3`)
 * - `majorWildcard`: highest available within a major (e.g., `1.*`)
 * - `minorWildcard`: highest available within a minor (e.g., `1.2.*`)
 * - `wildcard`: bare `*` — highest available
 * - `latest`: literal `latest` tag — highest available
 *
 * `wildcard` and `latest` collapse to the same resolution path
 * downstream. The variants are kept distinct so the parsed surface
 * form round-trips for display and lockfile diagnostics.
 */
export type VersionSpec =
  | { kind: 'exact'; major: number; minor: number; patch: number }
  | { kind: 'majorWildcard'; major: number }
  | { kind: 'minorWildcard'; major: number; minor: number }
  | { kind: 'wildcard' }
  | { kind: 'latest' }

/**
 * True when a `VersionSpec` resolves to "the highest published version"
 * (no constraint). Used by the resolver to collapse `*`, `latest`, and
 * the implicit bare-name spec into a single registry-resolution branch.
 */
export function resolvesToLatest(spec: VersionSpec): boolean {
  return spec.kind === 'wildcard' || spec.kind === 'latest'
}

/**
 * Parse error code. Each value identifies a specific rejection
 * reason so callers can branch on the cause without parsing strings.
 */
export type ParseErrorCode =
  | 'EMPTY'
  | 'GIT_PLUS_PREFIX'
  | 'CARET_RANGE'
  | 'TILDE_RANGE'
  | 'COMPARATOR_RANGE'
  | 'OR_RANGE'
  | 'X_RANGE'
  | 'INVALID_VERSION'
  | 'INVALID_REGISTRY_NAME'
  | 'UNKNOWN_SCHEME'

/**
 * A parse error. Shape mirrors `CliError` (what / fix) so the CLI can
 * surface these directly in its 3-line stderr block. `detail` is
 * derived by callers from the rejected input.
 */
export interface ParseError {
  code: ParseErrorCode
  what: string
  fix: string
}

/**
 * Result of a parse operation. Discriminated by `ok`.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError }
