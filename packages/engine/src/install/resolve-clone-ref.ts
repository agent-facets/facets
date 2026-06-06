import type { LockfileFacet } from '@agent-facets/protocol'

/**
 * Resolve which git commitish to clone for a facet on a cache miss.
 *
 * Reproducibility: when the lockfile pins a commit, clone exactly that
 * commit — never the manifest ref. The manifest ref can move (`#main`,
 * mutable tags); the locked commit cannot. Without this, a cache-miss
 * reinstall of a locked entry pointing at `#main` would silently pull
 * whatever main points to today, then either fail integrity
 * verification (frustrating) or rewrite the lockfile (worse — a silent
 * reproducibility break). Fresh adds (no `locked` entry) fall back to
 * the manifest ref.
 *
 * Pure function — exported for unit testing.
 */
export function resolveCloneRef(
  locked: LockfileFacet | undefined,
  manifestRef: string | undefined,
): string | undefined {
  return locked?.commit ?? manifestRef
}
