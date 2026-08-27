/**
 * Version-spec grammar: how versions are written inside facet artifacts
 * (project manifests and lockfiles). This is part of the protocol because
 * artifacts carry these specifiers; any system reading or writing them
 * MUST honor the same grammar.
 */

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
 * The largest value a single version component may take.
 *
 * `VersionSpec` carries components as JavaScript numbers, and every
 * consumer of this grammar compares and displays them as numbers. Above
 * `Number.MAX_SAFE_INTEGER` that representation stops being faithful:
 * `9007199254740992` and `9007199254740993` are the same double, so two
 * distinct releases would compare equal and one would silently install
 * in place of the other. The grammar therefore refuses those components
 * rather than admitting values it cannot tell apart.
 *
 * This is a bound on what the *grammar* accepts, not a limit any real
 * release approaches — a project would have to publish a major version
 * of nine quadrillion to reach it.
 */
export const MAX_VERSION_COMPONENT = Number.MAX_SAFE_INTEGER

/** `MAX_VERSION_COMPONENT` as digits, for magnitude comparison. */
const MAX_VERSION_COMPONENT_DIGITS = String(MAX_VERSION_COMPONENT)

/**
 * True when a run of decimal digits names a version component this
 * grammar can carry.
 *
 * Takes the digits rather than a number on purpose: converting first is
 * exactly the lossy step this guards against, so the comparison is done
 * on the string. Equal-length digit runs compare identically whether
 * read lexicographically or numerically, which is what makes the
 * length-then-lexical test below a faithful magnitude check.
 *
 * Input that is not a bare run of decimal digits is not a component of
 * this grammar at all and is rejected here too, so a caller cannot use
 * this as a "safe" verdict on something it never validated.
 */
export function isSafeVersionComponent(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits)) return false
  const significant = digits.replace(/^0+(?=[0-9])/, '')
  if (significant.length !== MAX_VERSION_COMPONENT_DIGITS.length) {
    return significant.length < MAX_VERSION_COMPONENT_DIGITS.length
  }
  return significant <= MAX_VERSION_COMPONENT_DIGITS
}

/**
 * True when a `VersionSpec` resolves to "the highest published version"
 * (no constraint). Used by resolvers to collapse `*`, `latest`, and the
 * implicit bare-name spec into a single registry-resolution branch.
 */
export function resolvesToLatest(spec: VersionSpec): boolean {
  return spec.kind === 'wildcard' || spec.kind === 'latest'
}

/**
 * True when a resolved exact version (the `M.N.P` a lockfile records)
 * satisfies a manifest's `VersionSpec`. Used by the installer to decide
 * whether a lockfile entry is still valid for its manifest specifier
 * (satisfying → honor the lock) or stale (not satisfying → re-resolve
 * against the registry).
 *
 *   - `exact`         → all three components equal
 *   - `majorWildcard` → major equal
 *   - `minorWildcard` → major and minor equal
 *   - `wildcard`      → always true (any version satisfies "highest")
 *   - `latest`        → always true
 *
 * Takes parsed components rather than a version string: the lockfile
 * schema narrows `version` to exact `M.N.P`, and engine parses it once
 * already, so the predicate stays pure and parse-free.
 */
export function satisfies(resolved: { major: number; minor: number; patch: number }, spec: VersionSpec): boolean {
  switch (spec.kind) {
    case 'exact':
      return resolved.major === spec.major && resolved.minor === spec.minor && resolved.patch === spec.patch
    case 'minorWildcard':
      return resolved.major === spec.major && resolved.minor === spec.minor
    case 'majorWildcard':
      return resolved.major === spec.major
    case 'wildcard':
    case 'latest':
      return true
  }
}
