/**
 * npm CLI operations.
 */

import { $ } from 'bun'

export const npmIo = {
  whoami: () => $`npm whoami`.quiet(),
  viewName: (pkg: string) => $`npm view ${pkg} name`.quiet(),
  viewVersion: (pkg: string, ver: string) => $`npm view ${pkg}@${ver} version`.quiet(),
  viewDistTag: (pkg: string, tag: string) => $`npm view ${pkg}@${tag} version`.quiet(),
  publish: (cwd: string, tag: string) => $`npm publish *.tgz --access public --tag ${tag}`.cwd(cwd),
  publishPlain: (cwd: string) => {
    const proc = Bun.spawn(['npm', 'publish', '--access', 'public'], {
      cwd,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'pipe',
    })
    return proc.exited.then(async (code) => {
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text()
        console.error(stderr)
        throw new Error(stderr || `Failed with exit code ${code}`)
      }
    })
  },
  npmPublish: (dir: string) => $`npm publish --access public`.cwd(dir),
  npmViewVersion: async (pkg: string): Promise<string | null> => {
    const result = await $`npm view ${pkg} version`.nothrow().quiet()
    return result.exitCode === 0 ? result.text().trim() : null
  },
}
