import { regex } from 'arkregex'

/**
 * Pre-compiled M.N.P matcher for `parseLockedVersion`. The pattern is
 * the same shape narrowed by the lockfile schemas' `version` narrow — schema and
 * parser stay aligned by deliberate convention; if you widen one, widen
 * the other. `arkregex` types the captures so destructuring is
 * cast-free; the runtime `RegExp` instance behaves identically to a
 * native one.
 *
 * No prerelease support: `VersionSpec` (the type returned below) only
 * models `M.N.P`. Adding prerelease support means widening this regex
 * AND the lockfile schema's narrow check AND `VersionSpec` itself.
 */
const LOCKED_VERSION_RE = regex('^(\\d+)\\.(\\d+)\\.(\\d+)$')

/**
 * Parse a `LockfileFacet.version` string into an exact `VersionSpec` for
 * the registry resolver. Lockfile versions are always concrete `M.N.P`
 * by contract (the lockfile schema narrows the field to exactly that
 * shape — see the lockfile schemas' `version` narrow in protocol). This function is
 * the engine-side counterpart that turns the validated string into the
 * structured form the registry resolver consumes.
 *
 * The schema gates malformed versions up front — by the time we get
 * here, `version` has already passed the narrow regex. If the regex
 * disagrees at runtime, that's a programmer bug (schema and parser
 * regex got out of sync), not a user-facing failure mode — hence the
 * `expect.unreachable`-style throw. Anti-pattern 4: this branch is
 * genuinely unreachable on validated input.
 *
 * Used on the registry-source cache-miss path to pin the metadata
 * fetch at `locked.version` instead of re-resolving the manifest spec
 * (which may be `@latest` or a wildcard). See the call site for the
 * reproducibility rationale.
 */
export function parseLockedVersion(version: string): {
  kind: 'exact'
  major: number
  minor: number
  patch: number
} {
  const match = LOCKED_VERSION_RE.exec(version)
  if (match === null) {
    // The schema narrow regex (the lockfile schemas' `version` narrow) has the same
    // shape as `LOCKED_VERSION_RE`. A null here means schema and parser
    // regex have drifted apart — programmer bug, not user input.
    throw new Error(`internal: lockfile schema accepted "${version}" but parseLockedVersion regex rejected it`)
  }
  const [, major, minor, patch] = match
  return {
    kind: 'exact',
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  }
}
