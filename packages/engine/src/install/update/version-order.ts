/**
 * Exact-version identity and ordering for update planning.
 *
 * Update is the first operation in the CLI that has to answer "is this
 * version newer than that one". Everything before it only ever asked
 * "does this version satisfy that specifier", which protocol's
 * `satisfies` answers by equality on the components a specifier pins.
 * Ordering is a genuinely different question and needs its own
 * primitive — but not its own grammar, which is why the parsing here
 * routes through the same version-spec parser the manifest uses.
 */

import type { VersionSpec } from '@agent-facets/protocol'
import { parseVersionSpec } from '../../sources/facet/parse-version.ts'

/**
 * An exact published version — the single `VersionSpec` arm that names
 * one immutable release.
 *
 * Derived from `VersionSpec` rather than declared as a fresh
 * `{ major, minor, patch }` interface so it stays structurally
 * identical to the parsed form, passes to protocol's `satisfies`
 * unchanged, and cannot drift if the grammar ever grows a component.
 */
export type ExactVersion = Extract<VersionSpec, { kind: 'exact' }>

/**
 * Parse an exact `MAJOR.MINOR.PATCH` string, or `undefined` when the
 * value is any other version form.
 *
 * `undefined` rather than a tagged failure: there is exactly one way to
 * not be an exact version, and callers uniformly turn that into their
 * own domain failure (an unusable lockfile version, a non-conforming
 * registry response) with context this function does not have.
 *
 * Unlike `parseLockedVersion`, this never throws. It is meant for
 * strings whose shape has not already been narrowed by a schema —
 * lockfile entries read from disk, versions returned over the wire.
 */
export function parseExactVersion(value: string): ExactVersion | undefined {
  const parsed = parseVersionSpec(value)
  if (!parsed.ok || parsed.value.kind !== 'exact') return undefined
  return parsed.value
}

/**
 * Order two exact versions: negative when `a` precedes `b`, zero when
 * they are the same release, positive when `a` follows `b`.
 *
 * Numeric per component, so `1.10.0` correctly follows `1.9.0` — the
 * trap that makes `compareCodeUnits` (used for lockfile key ordering)
 * the wrong tool for versions.
 */
export function compareExactVersions(a: ExactVersion, b: ExactVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/**
 * True when `candidate` is strictly newer than `current`.
 *
 * The strictness is the point: update never selects a version equal to
 * or older than what is installed, so every "can this be chosen"
 * question in discovery, selection, and application resolves through
 * this one predicate.
 */
export function isNewerThan(candidate: ExactVersion, current: ExactVersion): boolean {
  return compareExactVersions(candidate, current) > 0
}
