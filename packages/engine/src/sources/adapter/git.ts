import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Clones a Git repository to a temp directory.
 * Shells out to the `git` binary for compatibility with all auth methods.
 *
 * F15 hardening:
 *  - always ends option parsing with `--` before the URL so a URL that starts
 *    with `-` cannot be reinterpreted as a git-clone flag.
 *  - sets `GIT_TERMINAL_PROMPT=0` so auth failures error out immediately
 *    instead of hanging a non-interactive CI process on a password prompt.
 *
 * @param url - The Git URL (already stripped of the `git+` prefix)
 * @param commitish - Optional branch, tag, or commit hash
 * @returns The path to the cloned repository.
 */
export async function cloneAdapterGitRepository(url: string, commitish?: string): Promise<string> {
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
    const stderr = result.stderr.toString().trim()

    // Check if git binary is missing
    if (stderr.includes('not found') || stderr.includes('No such file')) {
      throw new Error('Git binary not found. Install git to use Git URL specifiers, or use an npm specifier instead.')
    }

    if (stderr.includes('could not read Username') || stderr.includes('Authentication failed')) {
      throw new Error(
        `Git authentication required for ${url}. Closed alpha supports public repos and SSH (via agent) only.`,
      )
    }

    throw new Error(`Failed to clone "${url}": ${stderr}`)
  }

  return tempDir
}
