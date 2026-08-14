import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FsSyscalls } from '../syscalls.ts'
import { nodeFsSyscalls } from '../syscalls.ts'

/**
 * A temp root resolved through `realpath`.
 *
 * macOS reaches `/var` through a symlink, and every containment check here is
 * textual. Without resolving it once, a legitimate temp path looks like an
 * escape from its own boundary.
 */
export function makeTempRoot(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

export function removeTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true })
}

/** An error indistinguishable from a real `NodeJS.ErrnoException`. */
export function errnoError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

/**
 * Wrap the real syscalls so one of them fails at a chosen moment.
 *
 * `land-then-throw` performs the real operation first: it reproduces the case
 * a journal armed *after* a syscall cannot survive — the write reached disk
 * and the report says it did not.
 */
export function faultAfter(
  operation: 'rename' | 'unlink',
  match: (path: string) => boolean,
  { code = 'EIO', times = 1 }: { code?: string; times?: number } = {},
): FsSyscalls {
  let remaining = times
  const shouldFire = (kind: string, path: string): boolean => {
    if (kind !== operation || remaining <= 0 || !match(path)) return false
    remaining--
    return true
  }
  return {
    ...nodeFsSyscalls,
    rename(from, to) {
      nodeFsSyscalls.rename(from, to)
      if (shouldFire('rename', to)) throw errnoError(code, `rename reported ${code} after landing`)
    },
    unlink(path) {
      nodeFsSyscalls.unlink(path)
      if (shouldFire('unlink', path)) throw errnoError(code, `unlink reported ${code} after landing`)
    },
  }
}

/** Wrap the real syscalls so one operation fails before doing anything. */
export function faultBefore(
  operation: 'rename' | 'unlink' | 'mkdir',
  match: (path: string) => boolean,
  code = 'EACCES',
): FsSyscalls {
  // Persistent by design: a permission problem does not clear itself between
  // the forward pass and the rollback.
  return {
    ...nodeFsSyscalls,
    rename(from, to) {
      if (operation === 'rename' && match(to)) throw errnoError(code)
      nodeFsSyscalls.rename(from, to)
    },
    unlink(path) {
      if (operation === 'unlink' && match(path)) throw errnoError(code)
      nodeFsSyscalls.unlink(path)
    },
    mkdir(path) {
      if (operation === 'mkdir' && match(path)) throw errnoError(code)
      nodeFsSyscalls.mkdir(path)
    },
  }
}

/**
 * Wrap the real syscalls so `mkdir` loses the race for a name.
 *
 * `plant` runs inside the faked `mkdir`, before it throws `EEXIST`, so what
 * it puts at the path is a real filesystem object by the time the code under
 * test looks again. Only `mkdir` is faked; every observation that follows is
 * genuine.
 *
 * `lstatAfter` fails the inspection that follows the lost race, and only that
 * one — faking `lstat` outright would break the check BEFORE the mkdir too,
 * which is not the code this exercises.
 */
export function occupyOnMkdir(
  match: (path: string) => boolean,
  plant: (path: string) => void,
  { times = 1, lstatAfter }: { times?: number; lstatAfter?: { code: string } } = {},
): FsSyscalls {
  let remaining = times
  const raced = new Set<string>()
  return {
    ...nodeFsSyscalls,
    mkdir(path) {
      if (remaining > 0 && match(path)) {
        remaining--
        plant(path)
        raced.add(path)
        throw errnoError('EEXIST', 'mkdir lost the race for this name')
      }
      nodeFsSyscalls.mkdir(path)
    },
    lstat(path) {
      if (lstatAfter !== undefined && raced.has(path)) throw errnoError(lstatAfter.code)
      return nodeFsSyscalls.lstat(path)
    },
  }
}

export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
export const text = (value: Uint8Array): string => new TextDecoder().decode(value)
