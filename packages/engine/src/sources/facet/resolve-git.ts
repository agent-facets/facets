import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Clones a git repository to a temp directory.
 *
 * Supports branch/tag refs AND commit SHAs (Adjustment T). Shells out to the
 * `git` binary for compatibility with all auth methods (SSH agent, HTTPS
 * creds via credential helper, etc.).
 *
 * All git invocations set `GIT_TERMINAL_PROMPT=0` (Adjustment O) so failing
 * auth errors out immediately instead of hanging waiting for a password.
 *
 * Failure modes are part of the function's contract — it never throws.
 * The caller pattern-matches on `result.reason` and routes each into the
 * matching `RunInstallFailure` code (`GIT_BINARY_MISSING`,
 * `GIT_AUTH_REQUIRED`, `GIT_CLONE_FAILED`, `GIT_CHECKOUT_FAILED`,
 * `GIT_COMMIT_UNRESOLVED`).
 */

/**
 * Discriminated result for `cloneFacetGitSource`. The success arm carries
 * the temp dir and the REQUIRED resolved HEAD commit; each failure arm
 * carries the fields the CLI needs to render a precise message without
 * parsing stderr text:
 *
 *   - `git-binary-missing` — `git` is not on `$PATH`. The user needs
 *     to install git before retrying.
 *   - `auth-required` — the registry rejected our auth attempt. The
 *     CLI's closed-alpha messaging mentions SSH-agent / public-repo
 *     constraints.
 *   - `clone-failed` — git ran but the clone itself failed for some
 *     other reason (network, ref not found, permission). Carries
 *     stderr verbatim for the CLI to surface.
 *   - `checkout-failed` — the SHA workflow's post-clone `git checkout`
 *     step failed (typically a typo in the requested commitish).
 *   - `commit-unresolved` — the clone succeeded but `git rev-parse HEAD`
 *     produced no commit. A git source that can't be pinned to a commit
 *     is not reproducible, so it fails loudly rather than producing a
 *     commitless lockfile entry.
 */
export type CloneFacetGitResult =
  | { ok: true; dir: string; commit: string }
  | { ok: false; reason: 'git-binary-missing' }
  | { ok: false; reason: 'auth-required'; url: string }
  | { ok: false; reason: 'clone-failed'; url: string; stderr: string }
  | { ok: false; reason: 'checkout-failed'; url: string; commitish: string; stderr: string }
  | { ok: false; reason: 'commit-unresolved'; url: string; stderr: string }

const SHA_RE = /^[0-9a-f]{7,40}$/

function gitEnv(): Record<string, string> {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>
}

interface RunGitResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
}

function runGit(args: string[], opts?: { cwd?: string }): RunGitResult {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: opts?.cwd,
    env: gitEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 1,
  }
}

/**
 * Classify a failed `git clone` stderr blob into the discriminated
 * failure shape. The three signatures (binary missing / auth required /
 * generic clone failure) are stable across git versions; everything
 * else falls through to the generic `clone-failed` arm with stderr
 * preserved verbatim for the CLI to surface.
 */
function classifyCloneFailure(url: string, stderr: string): Extract<CloneFacetGitResult, { ok: false }> {
  const text = stderr.trim()

  if (text.includes('not found') || text.includes('No such file')) {
    return { ok: false, reason: 'git-binary-missing' }
  }

  if (text.includes('could not read Username') || text.includes('Authentication failed')) {
    return { ok: false, reason: 'auth-required', url }
  }

  return { ok: false, reason: 'clone-failed', url, stderr: text }
}

export async function cloneFacetGitSource(url: string, commitish?: string): Promise<CloneFacetGitResult> {
  const dir = await mkdtemp(join(tmpdir(), 'facet-add-git-'))

  // F15 — always end `git clone` option parsing with `--` before the URL.
  // Combined with parse-source.ts's scheme allowlist, this ensures no URL
  // can be reinterpreted as a flag even if validation is ever bypassed.
  let cloneResult: RunGitResult
  let needsCheckout = false
  if (commitish && SHA_RE.test(commitish)) {
    // SHA workflow: full clone so any short-or-full SHA resolves via
    // `git checkout`. --depth=1 fetch-by-SHA requires 40-char SHAs and
    // allowReachableSHA1InWant on the server, so the simpler full-clone
    // path is more reliable and facet repos are small enough.
    cloneResult = runGit(['clone', '--', url, dir])
    needsCheckout = true
  } else if (commitish) {
    // Branch/tag workflow: single clone with --branch.
    cloneResult = runGit(['clone', '--depth=1', '--branch', commitish, '--', url, dir])
  } else {
    // Default branch.
    cloneResult = runGit(['clone', '--depth=1', '--', url, dir])
  }

  if (!cloneResult.ok) {
    // Temp dir is unusable; clean it up before returning. We swallow
    // errors here because the failure we report is the clone failure,
    // not a cleanup failure.
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return classifyCloneFailure(url, cloneResult.stderr)
  }

  if (needsCheckout && commitish !== undefined) {
    // `git checkout <ref>` — no `--` here because `git checkout -- <arg>`
    // forces pathspec mode and breaks ref/SHA resolution. The URL guard
    // lives on the clone step; this runs in an already-cloned repo with
    // no URL surface.
    const checkout = runGit(['checkout', commitish], { cwd: dir })
    if (!checkout.ok) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      return {
        ok: false,
        reason: 'checkout-failed',
        url,
        commitish,
        stderr: checkout.stderr.trim(),
      }
    }
  }

  // Resolve the current HEAD so the caller can pin it in the lockfile.
  // A git source MUST be pinnable to a commit — that commit is the
  // immutable identity that makes the install reproducible. If HEAD
  // can't be resolved after a successful clone, fail loudly rather than
  // writing a commitless (non-reproducible) lockfile entry.
  const revParse = runGit(['rev-parse', 'HEAD'], { cwd: dir })
  const commit = revParse.ok ? revParse.stdout.trim() : ''
  // Require a real SHA, not merely non-empty output: if `rev-parse` emits
  // unexpected/noisy text that isn't a commit, treat the source as unpinnable
  // rather than writing an invalid commit into the lockfile.
  if (commit.length === 0 || !SHA_RE.test(commit)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, reason: 'commit-unresolved', url, stderr: revParse.stderr.trim() }
  }

  return { ok: true, dir, commit }
}
