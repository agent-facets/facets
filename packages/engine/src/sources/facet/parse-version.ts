import { isSafeVersionComponent, MAX_VERSION_COMPONENT, type VersionSpec } from '@agent-facets/protocol'
import type { ParseErrorCode, ParseResult } from './types.ts'

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
      'use 1.* for major-pinned, 1.2.* for minor-pinned, 1.2.3 for exact, or latest',
    )
  }
  if (input.startsWith('~')) {
    return err(
      'TILDE_RANGE',
      `tilde ranges are not supported (got "${input}")`,
      'use 1.2.* for minor-pinned, 1.2.3 for exact, or latest',
    )
  }
  if (/^[<>]=?/.test(input)) {
    return err(
      'COMPARATOR_RANGE',
      `comparator ranges are not supported (got "${input}")`,
      'use 1.*, 1.2.3, or latest instead',
    )
  }
  if (input.includes('||')) {
    return err(
      'OR_RANGE',
      `OR ranges are not supported (got "${input}")`,
      'pick one version specifier — 1.*, 1.2.3, or latest',
    )
  }
  // Hyphen ranges: `1.0.0 - 2.0.0`. We detect the space-hyphen-space
  // pattern to avoid catching pre-release identifiers like `1.0.0-rc.1`.
  if (/\s-\s/.test(input)) {
    return err('COMPARATOR_RANGE', `hyphen ranges are not supported (got "${input}")`, 'use 1.*, 1.2.3, or latest')
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
    return err(
      'X_RANGE',
      `x-style ranges are not supported (got "${input}")`,
      'use * (e.g., 1.* or 1.2.*), 1.2.3, or latest instead',
    )
  }

  // Major-wildcard: `<major>.*`
  const majorWildcardMatch = /^(\d+)\.\*$/.exec(input)
  if (majorWildcardMatch && majorWildcardMatch[1] !== undefined) {
    const oversized = rejectOversized(input, [majorWildcardMatch[1]])
    if (oversized) return oversized
    const major = Number.parseInt(majorWildcardMatch[1], 10)
    return ok({ kind: 'majorWildcard', major })
  }

  // Minor-wildcard: `<major>.<minor>.*`
  const minorWildcardMatch = /^(\d+)\.(\d+)\.\*$/.exec(input)
  if (minorWildcardMatch && minorWildcardMatch[1] !== undefined && minorWildcardMatch[2] !== undefined) {
    const oversized = rejectOversized(input, [minorWildcardMatch[1], minorWildcardMatch[2]])
    if (oversized) return oversized
    const major = Number.parseInt(minorWildcardMatch[1], 10)
    const minor = Number.parseInt(minorWildcardMatch[2], 10)
    return ok({ kind: 'minorWildcard', major, minor })
  }

  // Exact: `<major>.<minor>.<patch>` — strict, no pre-release/build metadata.
  // We deliberately do NOT support pre-release identifiers in this milestone;
  // if/when needed, that's a follow-up change.
  const exactMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(input)
  if (exactMatch && exactMatch[1] !== undefined && exactMatch[2] !== undefined && exactMatch[3] !== undefined) {
    const oversized = rejectOversized(input, [exactMatch[1], exactMatch[2], exactMatch[3]])
    if (oversized) return oversized
    const major = Number.parseInt(exactMatch[1], 10)
    const minor = Number.parseInt(exactMatch[2], 10)
    const patch = Number.parseInt(exactMatch[3], 10)
    return ok({ kind: 'exact', major, minor, patch })
  }

  return err('INVALID_VERSION', `invalid version specifier "${input}"`, 'use 1.2.3, 1.*, 1.2.*, *, or latest')
}

/**
 * Refuse a specifier whose shape is right but whose magnitude is not,
 * before any component reaches `Number.parseInt`.
 *
 * The conversion is the lossy step: past `MAX_VERSION_COMPONENT` two
 * different releases land on the same double and compare equal, so a
 * specifier that got this far would resolve, order, and install as if it
 * named a version it does not. Rejecting is the only honest answer —
 * the parser cannot represent what it was asked to parse.
 */
function rejectOversized(input: string, components: readonly string[]): ParseResult<VersionSpec> | undefined {
  if (components.every((component) => isSafeVersionComponent(component))) return undefined
  return err(
    'VERSION_COMPONENT_TOO_LARGE',
    `version specifier "${input}" has a component larger than ${MAX_VERSION_COMPONENT}`,
    `use version components no larger than ${MAX_VERSION_COMPONENT}`,
  )
}

function ok(value: VersionSpec): ParseResult<VersionSpec> {
  return { ok: true, value }
}

function err(code: ParseErrorCode, what: string, fix: string): ParseResult<VersionSpec> {
  return { ok: false, error: { code, what, fix } }
}
