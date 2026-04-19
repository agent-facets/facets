import { mkdtemp } from 'node:fs/promises'
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
 * auth errors out immediately instead of hanging waiting for a password. The
 * caller should translate the "could not read Username" stderr pattern into
 * the closed-alpha auth failure message via the error helper.
 */

export type ResolveGitResult = {
  /** Absolute path to the cloned working tree (temp dir). */
  dir: string
  /** The resolved commit SHA at HEAD, or undefined if `git rev-parse` fails. */
  commit?: string
}

const SHA_RE = /^[0-9a-f]{7,40}$/

function gitEnv(): Record<string, string> {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>
}

function runGit(
  args: string[],
  opts?: { cwd?: string },
): { ok: boolean; stdout: string; stderr: string; exitCode: number } {
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

export async function cloneGitSource(url: string, commitish?: string): Promise<ResolveGitResult> {
  const dir = await mkdtemp(join(tmpdir(), 'facet-add-git-'))

  // F15 — always end `git clone` option parsing with `--` before the URL.
  // Combined with parse-source.ts's scheme allowlist, this ensures no URL can
  // be reinterpreted as a flag even if validation is ever bypassed.
  if (commitish && SHA_RE.test(commitish)) {
    // SHA workflow: full clone so any short-or-full SHA resolves via `git checkout`.
    // --depth=1 fetch-by-SHA requires 40-char SHAs and allowReachableSHA1InWant on the server,
    // so the simpler full-clone path is more reliable and facet repos are small enough.
    const clone = runGit(['clone', '--', url, dir])
    if (!clone.ok) {
      throw gitError(url, clone.stderr)
    }
    // `git checkout <ref>` — no `--` here because `git checkout -- <arg>`
    // forces pathspec mode and breaks ref/SHA resolution. The URL guard
    // lives on the clone step; this runs in an already-cloned repo with
    // no URL surface.
    const checkout = runGit(['checkout', commitish], { cwd: dir })
    if (!checkout.ok) {
      throw new Error(`failed to checkout commit ${commitish} in ${url}: ${checkout.stderr.trim()}`)
    }
  } else if (commitish) {
    // Branch/tag workflow: single clone with --branch.
    const clone = runGit(['clone', '--depth=1', '--branch', commitish, '--', url, dir])
    if (!clone.ok) {
      throw gitError(url, clone.stderr)
    }
  } else {
    // Default branch.
    const clone = runGit(['clone', '--depth=1', '--', url, dir])
    if (!clone.ok) {
      throw gitError(url, clone.stderr)
    }
  }

  // Resolve the current HEAD so the caller can pin it in the lockfile.
  const revParse = runGit(['rev-parse', 'HEAD'], { cwd: dir })
  const commit = revParse.ok ? revParse.stdout.trim() : undefined

  return { dir, commit }
}

/**
 * Translate common git error signatures into actionable messages the caller
 * can surface via the 3-line error helper.
 */
function gitError(url: string, stderr: string): Error {
  const text = stderr.trim()

  if (text.includes('not found') || text.includes('No such file')) {
    return new Error('git binary not found. Install git to use git-based facet sources.')
  }

  if (text.includes('could not read Username') || text.includes('Authentication failed')) {
    return new Error(
      `git authentication required for ${url}. Closed alpha supports public repos and SSH (via agent) only.`,
    )
  }

  return new Error(`git clone failed for ${url}: ${text}`)
}
