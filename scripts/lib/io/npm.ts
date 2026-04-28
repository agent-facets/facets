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
  /** Pack the workspace at `dir` into a tarball. Returns `bun pm pack --quiet` stdout, which is the filename. */
  pack: (dir: string) => $`bun pm pack --quiet`.cwd(dir).text(),
  /**
   * Publish a pre-packed tarball by filename, optionally with a dist-tag.
   *
   * `npm publish` accepts a single `<package-spec>`. Pass the exact filename
   * captured from `pack()` — never a glob — so a stale `*.tgz` left over from
   * a prior local pack can't expand to multiple args and trip EUSAGE.
   */
  publishTarball: (dir: string, filename: string, tag?: string) =>
    tag
      ? $`npm publish ${filename} --access public --tag ${tag}`.cwd(dir)
      : $`npm publish ${filename} --access public`.cwd(dir),
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
  /** Get the currently-published latest version of a package, or null if never published. */
  viewVersion: async (pkg: string): Promise<string | null> => {
    const result = await $`npm view ${pkg} version`.nothrow().quiet()
    return result.exitCode === 0 ? result.text().trim() : null
  },
}
