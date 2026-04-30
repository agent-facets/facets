import type { GitIntegrityInput, IntegrityCheck, IntegrityResult, RegistryIntegrityInput } from './types.ts'

/**
 * Verify a single hash equality.
 *
 * Returns `{ ok: true }` on match, `{ ok: false, failure }` on mismatch.
 *
 * Comparison is plain `===` — our threat model does not include
 * timing-side-channel attacks against local hash compares. If/when a
 * network surface accepts attacker-supplied hashes for verification,
 * this primitive is the place to introduce constant-time comparison.
 */
export function verifyHash(facet: string, check: IntegrityCheck, expected: string, observed: string): IntegrityResult {
  if (expected === observed) {
    return { ok: true }
  }
  return {
    ok: false,
    failure: { facet, check, expected, observed },
  }
}

/**
 * Run the registry integrity protocol. Returns the first failure
 * encountered, or `{ ok: true }` if all applicable checks pass.
 *
 * Check ordering:
 *
 *   1. Lockfile check (if `lockfileIntegrity` is provided).
 *      `expectedIntegrity` (from current registry metadata) must equal
 *      `lockfileIntegrity` (from committed `facets.lock`). This guards
 *      against the registry retroactively redefining a pinned version's
 *      integrity. Failure produces `check: 'lockfile'`.
 *
 *   2. Cache-hit branch (if `cachedIntegrity` is provided).
 *      Run **Check A only**: `cachedIntegrity` must equal
 *      `expectedIntegrity`. On match, cached content is trusted and the
 *      protocol returns `{ ok: true }` without recomputing anything.
 *      Failure produces `check: 'A'`. Checks B and C are skipped on
 *      both pass and fail of A — the cache hit means we never went to
 *      the network for an archive, so there's no archive manifest or
 *      computed content to check against.
 *
 *   3. Cache-miss branch (when `cachedIntegrity` is not provided).
 *      Run **Check B** then **Check C**:
 *        B: `archiveIntegrity` must equal `expectedIntegrity` (catches
 *           metadata-vs-tarball split-brain).
 *        C: `computedIntegrity` must equal `archiveIntegrity` (catches
 *           tampered archives whose self-declared integrity is intact).
 *      The first failing check determines the result.
 *
 * IMPORTANT contract for callers: the verifier is the gate before any
 * asset is written to disk. Callers MUST check `result.ok` and abort
 * the installation pipeline on `false` before performing any
 * materialize or lockfile-write side effect.
 */
export function verifyRegistryThreeCheck(input: RegistryIntegrityInput): IntegrityResult {
  // 1. Lockfile check, if applicable.
  if (input.lockfileIntegrity !== undefined) {
    const lockfileResult = verifyHash(input.facet, 'lockfile', input.lockfileIntegrity, input.expectedIntegrity)
    if (!lockfileResult.ok) {
      return lockfileResult
    }
  }

  // 2. Cache-hit branch.
  if (input.cachedIntegrity !== undefined) {
    return verifyHash(input.facet, 'A', input.expectedIntegrity, input.cachedIntegrity)
  }

  // 3. Cache-miss branch.
  const checkB = verifyHash(input.facet, 'B', input.expectedIntegrity, input.archiveIntegrity)
  if (!checkB.ok) {
    return checkB
  }
  return verifyHash(input.facet, 'C', input.archiveIntegrity, input.computedIntegrity)
}

/**
 * Run the git integrity check. Returns `{ ok: true }` if the locally-
 * built artifact's integrity matches the lockfile's recorded integrity,
 * otherwise the structured failure with `check: 'git'`.
 *
 * This is the single check that catches tag-move attacks: the symbolic
 * ref the user committed (`#main`, `#v1.0.0`) may now resolve to a
 * different commit whose build hashes differently than what was locked.
 *
 * No equivalent verifier exists for local sources because local sources
 * have no integrity contract beyond filesystem trust — callers should
 * skip the verifier entirely for `kind: 'local'`.
 */
export function verifyGitOneCheck(input: GitIntegrityInput): IntegrityResult {
  return verifyHash(input.facet, 'git', input.lockfileIntegrity, input.computedIntegrity)
}
