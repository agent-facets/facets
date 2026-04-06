/**
 * I/O adapter — a single location for all external side effects.
 *
 * All npm commands, shell commands, and file operations go through this
 * object. Tests mock individual methods via spyOn(io, "method").
 */

import { $ } from 'bun'

export const io = {
  // npm
  whoami: () => $`npm whoami`.quiet(),
  viewName: (pkg: string) => $`npm view ${pkg} name`.quiet(),
  viewVersion: (pkg: string, ver: string) => $`npm view ${pkg}@${ver} version`.quiet(),
  publish: (cwd: string, tag: string) => $`npm publish *.tgz --provenance --access public --tag ${tag}`.cwd(cwd),
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
  viewDistTag: (pkg: string, tag: string) => $`npm view ${pkg}@${tag} version`.quiet(),
  distTagAdd: (pkg: string, ver: string, tag: string) => $`npm dist-tag add ${pkg}@${ver} ${tag}`,

  // shell
  pack: (cwd: string) => $`bun pm pack`.cwd(cwd),
  chmod: (cwd: string) => $`chmod -R 755 .`.cwd(cwd).nothrow(),
  rm: (path: string) => $`rm -rf ${path}`.nothrow(),
  mkdir: (path: string) => $`mkdir -p ${path}`,

  // fs
  readFile: (path: string) => Bun.file(path).text(),
  writeFile: (path: string, content: string) => Bun.write(path, content),
}
