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
