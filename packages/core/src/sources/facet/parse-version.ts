import type { ParseResult, VersionSpec } from './types.ts'

/**
 * Parse a version specifier string into a `VersionSpec`.
 *
 * Accepted forms:
 *   - `1.2.3`          → exact
 *   - `1.*`            → majorWildcard
 *   - `1.2.*`          → minorWildcard
 *   - `*`              → wildcard
 *   - `latest`         → latest
 *
 * All other forms are rejected. Comparator ranges (`^`, `~`, `>=`, etc.),
 * OR ranges (`||`), hyphen ranges (`1.0.0 - 2.0.0`), and `x`-style
 * placeholders (`1.x`, `1.2.x`) are explicitly rejected — each with an
 * error pointing the user at the supported wildcard equivalent.
 *
 * Pure function: no I/O, no exceptions, deterministic.
 */
export function parseVersionSpec(input: string): ParseResult<VersionSpec> {
  if (input.length === 0) {
    return err('EMPTY', 'empty version specifier', 'use 1.2.3, 1.*, 1.2.*, *, or latest')
  }

  // Reject comparator and combinator ranges before anything else.
  // Order matters: caret/tilde must be checked before bare numeric.
  if (input.startsWith('^')) {
    return err(
      'CARET_RANGE',
      `caret ranges are not supported (got "${input}")`,
      'use 1.* for major-pinned, 1.2.* for minor-pinned, or 1.2.3 for exact',
    )
  }
  if (input.startsWith('~')) {
    return err(
      'TILDE_RANGE',
      `tilde ranges are not supported (got "${input}")`,
      'use 1.2.* for minor-pinned or 1.2.3 for exact',
    )
  }
  if (/^[<>]=?/.test(input)) {
    return err('COMPARATOR_RANGE', `comparator ranges are not supported (got "${input}")`, 'use 1.* or 1.2.3 instead')
  }
  if (input.includes('||')) {
    return err('OR_RANGE', `OR ranges are not supported (got "${input}")`, 'pick one version specifier — 1.* or 1.2.3')
  }
  // Hyphen ranges: `1.0.0 - 2.0.0`. We detect the space-hyphen-space
  // pattern to avoid catching pre-release identifiers like `1.0.0-rc.1`.
  if (/\s-\s/.test(input)) {
    return err('COMPARATOR_RANGE', `hyphen ranges are not supported (got "${input}")`, 'use 1.* or 1.2.3')
  }

  // Literal `latest` tag.
  if (input === 'latest') {
    return ok({ kind: 'latest' })
  }

  // Bare wildcard.
  if (input === '*') {
    return ok({ kind: 'wildcard' })
  }

  // x-style placeholders: 1.x, 1.2.x, 1.X
  if (/^\d+(?:\.\d+)?\.[xX]$/.test(input) || /^\d+\.[xX]$/.test(input)) {
    return err('X_RANGE', `x-style ranges are not supported (got "${input}")`, 'use * (e.g., 1.* or 1.2.*) instead')
  }

  // Major-wildcard: `<major>.*`
  const majorWildcardMatch = /^(\d+)\.\*$/.exec(input)
  if (majorWildcardMatch && majorWildcardMatch[1] !== undefined) {
    const major = Number.parseInt(majorWildcardMatch[1], 10)
    return ok({ kind: 'majorWildcard', major })
  }

  // Minor-wildcard: `<major>.<minor>.*`
  const minorWildcardMatch = /^(\d+)\.(\d+)\.\*$/.exec(input)
  if (minorWildcardMatch && minorWildcardMatch[1] !== undefined && minorWildcardMatch[2] !== undefined) {
    const major = Number.parseInt(minorWildcardMatch[1], 10)
    const minor = Number.parseInt(minorWildcardMatch[2], 10)
    return ok({ kind: 'minorWildcard', major, minor })
  }

  // Exact: `<major>.<minor>.<patch>` — strict, no pre-release/build metadata.
  // We deliberately do NOT support pre-release identifiers in this milestone;
  // if/when needed, that's a follow-up change.
  const exactMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(input)
  if (exactMatch && exactMatch[1] !== undefined && exactMatch[2] !== undefined && exactMatch[3] !== undefined) {
    const major = Number.parseInt(exactMatch[1], 10)
    const minor = Number.parseInt(exactMatch[2], 10)
    const patch = Number.parseInt(exactMatch[3], 10)
    return ok({ kind: 'exact', major, minor, patch })
  }

  return err('INVALID_VERSION', `invalid version specifier "${input}"`, 'use 1.2.3, 1.*, 1.2.*, *, or latest')
}

function ok(value: VersionSpec): ParseResult<VersionSpec> {
  return { ok: true, value }
}

function err(
  code: 'EMPTY' | 'CARET_RANGE' | 'TILDE_RANGE' | 'COMPARATOR_RANGE' | 'OR_RANGE' | 'X_RANGE' | 'INVALID_VERSION',
  what: string,
  fix: string,
): ParseResult<VersionSpec> {
  return { ok: false, error: { code, what, fix } }
}
