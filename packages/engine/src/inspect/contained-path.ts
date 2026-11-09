import { lstat, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

export type ContainedPath = { ok: true; path: string } | { ok: false; code: 'missing' | 'unsafe' }

/**
 * Resolve a declared file inside a facet root, refusing anything that would
 * read outside it: a symlink at the file or at any directory between the root
 * and the file, a hard link, a non-regular file, or a real path that escapes
 * the root.
 *
 * A local facet's directory comes from the project (often a cloned repo), so
 * a declared `README.md` that is a symlink to `~/.aws/credentials` would
 * otherwise be printed by `facet cat`. Install applies the same rules when it
 * builds a local facet (`build/load-supplementary-sources.ts`).
 *
 * Validation and the caller's read are separate syscalls; a local process
 * able to swap files in between already has the user's file access.
 */
export async function containedPath(root: string, relative: string): Promise<ContainedPath> {
  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch {
    return { ok: false, code: 'missing' }
  }
  const segments = relative.split('/')
  let current = rootReal
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    let stats: Awaited<ReturnType<typeof lstat>>
    try {
      stats = await lstat(current)
    } catch {
      return { ok: false, code: 'missing' }
    }
    if (stats.isSymbolicLink()) return { ok: false, code: 'unsafe' }
    const last = index === segments.length - 1
    if (last && (!stats.isFile() || stats.nlink > 1)) return { ok: false, code: 'unsafe' }
    if (!last && !stats.isDirectory()) return { ok: false, code: 'missing' }
  }
  const real = await realpath(current).catch(() => undefined)
  if (real === undefined || !real.startsWith(`${rootReal}${sep}`)) return { ok: false, code: 'unsafe' }
  return { ok: true, path: real }
}
