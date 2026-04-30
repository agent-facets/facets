/**
 * Identifies which check failed when an integrity verification rejects.
 *
 * Per the three-check protocol:
 *
 *   - `'lockfile'`: the registry's current `expectedIntegrity` for a
 *     given (name, version) does not match the integrity recorded in
 *     the project's committed `facets.lock`. Highest-priority failure
 *     mode — the registry has retroactively redefined what a pinned
 *     version should hash to.
 *   - `'A'`: cache vs. registry metadata. Triggered on cache hit when
 *     the cached integrity does not match the registry's current
 *     metadata. The cache wins; the registry is the suspicious side.
 *   - `'B'`: archive manifest vs. registry metadata. Triggered when the
 *     downloaded archive's self-declared integrity does not match the
 *     metadata-API integrity. Detects metadata-vs-tarball split-brain.
 *   - `'C'`: computed content vs. archive manifest. Triggered when the
 *     archive's content hashes to a value other than what its own
 *     manifest claims. Detects tampered tarballs.
 *   - `'git'`: built artifact vs. lockfile integrity for a git source.
 *     Detects tag-move attacks (the symbolic ref now resolves to a
 *     different commit whose build hashes differently).
 */
export type IntegrityCheck = 'lockfile' | 'A' | 'B' | 'C' | 'git'

/**
 * A specific integrity failure.
 *
 * Pure data: no `Error` instance, no stack trace, no thrown exception.
 * Callers render this through their normal display path.
 */
export interface IntegrityFailure {
  facet: string
  check: IntegrityCheck
  expected: string
  observed: string
}

/**
 * Result of an integrity verification. Discriminated by `ok`.
 *
 * The verifier never throws. Callers branch on `result.ok` and either
 * proceed (on success) or surface the structured failure (on rejection).
 */
export type IntegrityResult = { ok: true } | { ok: false; failure: IntegrityFailure }

/**
 * Inputs to the registry three-check pipeline.
 *
 * Field semantics:
 *   - `expectedIntegrity`: from the registry's metadata API. The hash
 *     the registry claims this exact `(name, version)` should produce.
 *   - `archiveIntegrity`: from the downloaded archive's own
 *     `build-manifest.json`. The hash the archive claims about itself.
 *   - `computedIntegrity`: locally computed by hashing the extracted
 *     archive content. The hash that's actually true.
 *   - `cachedIntegrity` (optional): present iff the resolution is a
 *     cache hit. When set, only Check A runs against `expectedIntegrity`
 *     and Checks B/C are skipped (cached content is trusted post-write).
 *   - `lockfileIntegrity` (optional): present iff the project's lockfile
 *     pins this `(name, version)`. When set, the registry's
 *     `expectedIntegrity` is first checked against it; mismatch is
 *     reported with `check: 'lockfile'` and is the highest-priority
 *     failure mode.
 */
export interface RegistryIntegrityInput {
  facet: string
  expectedIntegrity: string
  archiveIntegrity: string
  computedIntegrity: string
  cachedIntegrity?: string
  lockfileIntegrity?: string
}

/**
 * Inputs to the git one-check pipeline.
 *
 * Git sources have only the locally-built integrity to check against the
 * lockfile's recorded integrity. There is no metadata API; the symbolic
 * ref is what the user trusts.
 */
export interface GitIntegrityInput {
  facet: string
  computedIntegrity: string
  lockfileIntegrity: string
}
