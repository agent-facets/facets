/**
 * npm CLI operations.
 */

import { $ } from 'bun'

export const npmIo = {
  whoami: () => $`npm whoami`.quiet(),
  viewName: (pkg: string) => $`npm view ${pkg} name`.quiet(),
  /** Check that a specific version of a package exists — returns the shell result. */
  checkVersion: (pkg: string, ver: string) => $`npm view ${pkg}@${ver} version`.quiet(),
  viewDistTag: (pkg: string, tag: string) => $`npm view ${pkg}@${tag} version`.quiet(),
  /** Publish a pre-packed .tgz with an explicit dist-tag. */
  publishTarball: (cwd: string, tag: string) => $`npm publish *.tgz --access public --tag ${tag}`.cwd(cwd),
  /** Publish interactively with inherited stdio — used for OIDC bootstrap flows. */
  publishPlain: async (cwd: string) => {
    const proc = Bun.spawn(['npm', 'publish', '--access', 'public'], {
      cwd,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'pipe',
    })
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      console.error(stderr)
      throw new Error(stderr || `Failed with exit code ${code}`)
    }
  },
  /** Publish the package in `dir` using its own package.json dist-tag. */
  publish: (dir: string) => $`npm publish --access public`.cwd(dir),
  /** Get the currently-published latest version of a package, or null if never published. */
  viewVersion: async (pkg: string): Promise<string | null> => {
    const result = await $`npm view ${pkg} version`.nothrow().quiet()
    return result.exitCode === 0 ? result.text().trim() : null
  },
}
