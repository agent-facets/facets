import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Clones a Git repository to a temp directory.
 * Shells out to the `git` binary for compatibility with all auth methods.
 *
 * @param url - The Git URL (already stripped of the `git+` prefix)
 * @param commitish - Optional branch, tag, or commit hash
 * @returns The path to the cloned repository.
 */
export async function cloneGitRepository(url: string, commitish?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'facet-harness-git-'))

  const args = ['clone', '--depth=1']
  if (commitish) {
    args.push('--branch', commitish)
  }
  args.push(url, tempDir)

  const result = Bun.spawnSync(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()

    // Check if git binary is missing
    if (stderr.includes('not found') || stderr.includes('No such file')) {
      throw new Error('Git binary not found. Install git to use Git URL specifiers, or use an npm specifier instead.')
    }

    throw new Error(`Failed to clone "${url}": ${stderr}`)
  }

  return tempDir
}
