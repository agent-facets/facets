/**
 * Tagged-union types for facet sources.
 *
 * These types model the full surface of what a user can write as a
 * facet source string in CLI input. Every value that flows through
 * source-resolution descends from one of these unions.
 *
 * Design rule: NO optional discriminators. Every variant has its own
 * required-field set. Illegal combinations are unrepresentable.
 *
 * The `VersionSpec` type and its grammar live in `@agent-facets/protocol`
 * because version specifiers appear inside published artifacts (project
 * manifests, lockfiles); the surrounding `Source` discriminant
 * (github/git/file/registry) is engine-internal — it's how *this CLI*
 * interprets user-supplied source strings.
 */

import type { VersionSpec } from '@agent-facets/protocol'

/**
 * A facet source. One of three variants:
 *
 * - `registry`: a published facet (e.g., `viper-plans@1.2.3`)
 * - `git`: a git repository (https URL, ssh URL, github shorthand, SCP form)
 * - `local`: a local filesystem path
 */
export type Source =
  | { kind: 'registry'; name: string; version: VersionSpec }
  | { kind: 'git'; url: string; ref?: string }
  | { kind: 'local'; path: string }

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
  /**
   * The specifier has a conforming shape but names a component the
   * grammar cannot carry — see protocol's `MAX_VERSION_COMPONENT`.
   * Distinct from `INVALID_VERSION` because the fix is different: the
   * form was right, the number was too big.
   */
  | 'VERSION_COMPONENT_TOO_LARGE'
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
