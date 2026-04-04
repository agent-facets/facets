import { mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { FACET_MANIFEST_FILE } from '@agent-facets/core'

export interface ResolvedDir {
  ok: true
  dir: string
  display: string
}

export interface ResolvedDirError {
  ok: false
  message: string
}

export type ResolveResult = ResolvedDir | ResolvedDirError

export interface ResolveOptions {
  mustExist: boolean
  facetMustExist?: boolean
}

/**
 * Validates and resolves a directory argument for CLI commands.
 *
 * Handles:
 * - No argument → uses process.cwd(), display as '.'
 * - Argument ending with facet.json → silently uses parent directory
 * - Argument is a non-directory file → error
 * - Directory doesn't exist + mustExist false → auto-creates it
 * - Directory doesn't exist + mustExist true → error
 * - facetMustExist true but no facet.json → error
 */
export async function resolveTargetDir(arg: string | undefined, opts: ResolveOptions): Promise<ResolveResult> {
  const display = arg || '.'

  // No argument → current directory
  if (!arg) {
    const dir = process.cwd()

    if (opts.facetMustExist) {
      const manifestExists = await Bun.file(join(dir, FACET_MANIFEST_FILE)).exists()
      if (!manifestExists) {
        return { ok: false, message: `No ${FACET_MANIFEST_FILE} found in ${display}` }
      }
    }

    return { ok: true, dir, display }
  }

  // Pointing to facet.json directly → use parent directory
  if (arg === FACET_MANIFEST_FILE || arg.endsWith(`/${FACET_MANIFEST_FILE}`)) {
    const dir = resolve(dirname(arg))

    const dirStat = await stat(dir).catch(() => null)
    if (!dirStat?.isDirectory()) {
      return { ok: false, message: `Directory does not exist: ${dirname(arg)}` }
    }

    if (opts.facetMustExist) {
      const manifestExists = await Bun.file(join(dir, FACET_MANIFEST_FILE)).exists()
      if (!manifestExists) {
        return { ok: false, message: `No ${FACET_MANIFEST_FILE} found in ${display}` }
      }
    }

    return { ok: true, dir, display: dirname(arg) || '.' }
  }

  // Check if the path exists
  const pathStat = await stat(arg).catch(() => null)

  // Path exists but is a file, not a directory
  if (pathStat && !pathStat.isDirectory()) {
    return { ok: false, message: `Expected a directory, not a file: ${arg}` }
  }

  // Path doesn't exist
  if (!pathStat) {
    if (opts.mustExist) {
      return { ok: false, message: `Directory does not exist: ${arg}` }
    }

    // Auto-create for commands that allow it (e.g., create)
    await mkdir(arg, { recursive: true })
  }

  const dir = resolve(arg)

  if (opts.facetMustExist) {
    const manifestExists = await Bun.file(join(dir, FACET_MANIFEST_FILE)).exists()
    if (!manifestExists) {
      return { ok: false, message: `No ${FACET_MANIFEST_FILE} found in ${display}` }
    }
  }

  return { ok: true, dir, display }
}
