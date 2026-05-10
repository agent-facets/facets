import { resolve } from 'node:path'

/**
 * Discriminated result for `resolveLocalAdapterPath`. The success arm
 * carries the resolved absolute path; the failure arm carries the
 * input the user provided so the CLI can echo it back verbatim.
 *
 *   - `not-found` — neither the path itself nor a `package.json`
 *     beneath it exists. Returned for typos, broken symlinks, or
 *     paths that point outside the user's tree.
 */
export type ResolveLocalAdapterResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'not-found'; inputPath: string }

/**
 * Validate and resolve a local filesystem path for adapter installation.
 * The path is resolved to an absolute path relative to cwd.
 *
 * Returns a discriminated `ResolveLocalAdapterResult` — never throws.
 * Errors are values; the caller pattern-matches on `result.reason`.
 *
 * @param inputPath - The path as provided by the user (relative or absolute)
 */
export async function resolveLocalAdapterPath(inputPath: string): Promise<ResolveLocalAdapterResult> {
  const absolutePath = resolve(inputPath)

  const file = Bun.file(absolutePath)
  const exists = await file.exists()

  if (!exists) {
    // Check if it's a directory (Bun.file doesn't work on directories)
    const dir = Bun.file(`${absolutePath}/package.json`)
    const dirExists = await dir.exists()
    if (!dirExists) {
      return { ok: false, reason: 'not-found', inputPath }
    }
  }

  return { ok: true, path: absolutePath }
}
