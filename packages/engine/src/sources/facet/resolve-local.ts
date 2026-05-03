import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'

/**
 * Resolve a local facet source path and enforce tree containment.
 *
 * Resolution rules:
 *   - Relative paths are resolved against `projectRoot`.
 *   - Absolute paths are used as-is.
 *   - After resolution, the path (with symlinks followed) must stay within
 *     `projectRoot`. Paths that escape the tree — directly or via a symlink
 *     pointing outside — are rejected.
 *   - The path must exist and be a directory (facets are built from a
 *     directory containing a facet.json).
 */

export type ResolveLocalFacetResult = { ok: true; dir: string } | { ok: false; error: string }

export async function resolveLocalFacetSource(path: string, projectRoot: string): Promise<ResolveLocalFacetResult> {
  const absolute = isAbsolute(path) ? path : resolve(projectRoot, path)

  // Existence check
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(absolute)
  } catch {
    return { ok: false, error: `no facet found at ${path}` }
  }
  if (!stats.isDirectory()) {
    return { ok: false, error: `local path ${path} is not a directory` }
  }

  // Symlink-aware containment check: realpath strips symlinks so a symlink
  // pointing outside the tree is caught here.
  let real: string
  try {
    real = await realpath(absolute)
  } catch {
    return { ok: false, error: `failed to resolve local path ${path}` }
  }

  const rootReal = await realpath(projectRoot)
  const rootPrefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`
  if (real !== rootReal && !real.startsWith(rootPrefix)) {
    return { ok: false, error: `local path ${path} is outside the project tree` }
  }

  return { ok: true, dir: real }
}
