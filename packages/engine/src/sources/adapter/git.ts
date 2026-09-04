import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Discriminated result for `cloneAdapterGitRepository`. Mirrors the
 * facet-side `CloneFacetGitResult` shape (see
 * `sources/facet/resolve-git.ts`) so the two sources can route
 * failures into the same CLI rendering surface if we ever consolidate.
 *
 *   - `git-binary-missing` — `git` is not installed (or not on PATH).
 *   - `auth-required` — the remote rejected the auth attempt; HTTPS
 *     cloning supports public repositories, and private repositories
 *     require SSH agent authentication.
 *   - `clone-failed` — clone failed for some other reason. Carries
 *     stderr verbatim for the CLI to surface.
 */
export type CloneAdapterGitResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'git-binary-missing' }
  | { ok: false; reason: 'auth-required'; url: string }
  | { ok: false; reason: 'clone-failed'; url: string; stderr: string }

/**
 * Classify a failed `git clone` stderr blob into the discriminated
 * failure shape. Mirrors `classifyCloneFailure` in `facet/resolve-git.ts`.
 */
function classifyCloneFailure(url: string, stderr: string): Extract<CloneAdapterGitResult, { ok: false }> {
  const text = stderr.trim()

  if (text.includes('not found') || text.includes('No such file')) {
    return { ok: false, reason: 'git-binary-missing' }
  }

  if (text.includes('could not read Username') || text.includes('Authentication failed')) {
    return { ok: false, reason: 'auth-required', url }
  }

  return { ok: false, reason: 'clone-failed', url, stderr: text }
}

/**
 * Clone a Git repository to a temp directory.
 * Shells out to the `git` binary for compatibility with all auth methods.
 *
 * F15 hardening:
 *  - always ends option parsing with `--` before the URL so a URL that starts
 *    with `-` cannot be reinterpreted as a git-clone flag.
 *  - sets `GIT_TERMINAL_PROMPT=0` so auth failures error out immediately
 *    instead of hanging a non-interactive CI process on a password prompt.
 *
 * Returns a discriminated `CloneAdapterGitResult` — never throws.
 *
 * @param url - The Git URL (already stripped of the `git+` prefix)
 * @param commitish - Optional branch, tag, or commit hash
 */
export async function cloneAdapterGitRepository(url: string, commitish?: string): Promise<CloneAdapterGitResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'facet-adapter-git-'))

  const args = ['clone', '--depth=1']
  if (commitish) {
    args.push('--branch', commitish)
  }
  args.push('--', url, tempDir)

  const result = Bun.spawnSync(['git', ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    // Temp dir is unusable; clean up before returning. We swallow cleanup
    // errors because the failure we report is the clone failure.
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    return classifyCloneFailure(url, result.stderr.toString())
  }

  return { ok: true, path: tempDir }
}
