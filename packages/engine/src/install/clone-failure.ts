import type { CloneFacetGitResult } from '../sources/facet/resolve-git.ts'
import type { RunInstallFailure } from './types.ts'

/**
 * Translate a `cloneFacetGitSource` failure into the matching
 * `RunInstallFailure` code. Each `reason` arm maps to exactly one
 * code; structured fields (URL, stderr, commitish) flow through
 * unchanged so the CLI doesn't have to reparse stderr text.
 */
export function cloneFailureToRunInstall(
  facet: string,
  cloned: Extract<CloneFacetGitResult, { ok: false }>,
): RunInstallFailure {
  switch (cloned.reason) {
    case 'git-binary-missing':
      return { code: 'GIT_BINARY_MISSING', facet }
    case 'auth-required':
      return { code: 'GIT_AUTH_REQUIRED', facet, url: cloned.url }
    case 'clone-failed':
      return { code: 'GIT_CLONE_FAILED', facet, url: cloned.url, stderr: cloned.stderr }
    case 'checkout-failed':
      return {
        code: 'GIT_CHECKOUT_FAILED',
        facet,
        url: cloned.url,
        commitish: cloned.commitish,
        stderr: cloned.stderr,
      }
    case 'commit-unresolved':
      return { code: 'GIT_COMMIT_UNRESOLVED', facet, url: cloned.url, stderr: cloned.stderr }
  }
}
