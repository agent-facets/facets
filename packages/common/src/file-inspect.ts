import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, type Stats, statSync } from 'node:fs'
import { type FileState, regularFile } from './file-mutation.ts'

/**
 * Reading a path's exact state, and refusing to guess.
 *
 * This lives beside the file vocabulary because both sides of a mutation plan
 * need it: an adapter must report the state it planned against, and the engine
 * must confirm that state still holds before it writes. Two implementations
 * would be two opinions about what "the file is absent" means, and the answer
 * is asymmetric — mistaking a readable file for an absent one arms a restore
 * that DELETES it.
 */

/** The read-only syscalls inspection needs. Injectable so failures are testable. */
export interface FileReadSyscalls {
  /** `lstat` — never follows a final symlink. There is deliberately no plain `stat` for targets. */
  lstat(path: string): Stats
  /** `stat` — follows symlinks. For confirming a directory boundary only. */
  statFollowing(path: string): Stats
  /** Open for reading without following a final symlink. */
  openRead(path: string): number
  fstat(fd: number): Stats
  readFd(fd: number): Uint8Array
  close(fd: number): void
}

/**
 * `O_NOFOLLOW` closes the final-component symlink race that `lstat`-then-open
 * cannot: between the two calls the name could be replaced by a link, and a
 * following open would then read its target instead.
 */
const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0

/** The permission bits `FileState.mode` carries. Type bits are not state. */
export const FILE_MODE_MASK = 0o7777

export const nodeFileReadSyscalls: FileReadSyscalls = {
  lstat: (path) => lstatSync(path),
  statFollowing: (path) => statSync(path),
  openRead: (path) => openSync(path, constants.O_RDONLY | NOFOLLOW),
  fstat: (fd) => fstatSync(fd),
  readFd: (fd) => readFileSync(fd),
  close: (fd) => closeSync(fd),
}

/**
 * A filesystem object no plan may target.
 *
 * `hard-linked` is here because replacement is create-then-rename: the new
 * inode is reachable only by the name renamed onto, so every other name for
 * the old inode silently keeps the old bytes, and restoring afterwards
 * recreates the file but not the link. Preserving link topology is out of
 * scope, so a hard-linked target fails closed rather than being quietly broken.
 */
export type UnsupportedObjectKind =
  | 'symlink'
  | 'directory'
  | 'fifo'
  | 'socket'
  | 'character-device'
  | 'block-device'
  | 'hard-linked'
  | 'unknown'

/**
 * Why a path's state could not be established.
 *
 * Kept out of `FileState` on purpose: an unsupported object is not a state a
 * plan may target, and folding it in would let a caller write
 * "expected: a FIFO".
 */
export type InspectFileFailure =
  | { readonly reason: 'unsupported-object'; readonly path: string; readonly objectKind: UnsupportedObjectKind }
  | { readonly reason: 'symlinked-ancestor'; readonly path: string; readonly component: string }
  | { readonly reason: 'parent-unusable'; readonly path: string; readonly component: string }
  | { readonly reason: 'unreadable'; readonly path: string; readonly code?: string; readonly message: string }

export type InspectFileResult = { ok: true; state: FileState } | { ok: false; failure: InspectFileFailure }

/** The errno of a caught filesystem error, when it has one. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as NodeJS.ErrnoException).code
  return typeof code === 'string' ? code : undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** ENOENT alone. ENOTDIR means an ancestor is not a directory, which is not absence. */
export function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

interface ObjectKindStats {
  isSymbolicLink(): boolean
  isDirectory(): boolean
  isFIFO(): boolean
  isSocket(): boolean
  isCharacterDevice(): boolean
  isBlockDevice(): boolean
  isFile(): boolean
  nlink: number
}

/** Classify a stat result. Returns null when the object is an ordinary file. */
function unsupportedKind(stats: ObjectKindStats): UnsupportedObjectKind | null {
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isDirectory()) return 'directory'
  if (stats.isFIFO()) return 'fifo'
  if (stats.isSocket()) return 'socket'
  if (stats.isCharacterDevice()) return 'character-device'
  if (stats.isBlockDevice()) return 'block-device'
  if (!stats.isFile()) return 'unknown'
  if (stats.nlink > 1) return 'hard-linked'
  return null
}

function unreadable(path: string, error: unknown): InspectFileResult {
  const code = errorCode(error)
  return {
    ok: false,
    failure:
      code === undefined
        ? { reason: 'unreadable', path, message: errorMessage(error) }
        : { reason: 'unreadable', path, code, message: errorMessage(error) },
  }
}

/**
 * Read a path's exact state.
 *
 * Two observations, not one: `lstat` decides whether the object is something
 * we may touch at all, then a no-follow open re-checks the same question on
 * the descriptor actually read. The second check is what makes the answer true
 * of the bytes returned rather than of whatever occupied the name a moment
 * earlier.
 */
export function inspectFileState(path: string, sys: FileReadSyscalls = nodeFileReadSyscalls): InspectFileResult {
  let linkStats: Stats
  try {
    linkStats = sys.lstat(path)
  } catch (error) {
    if (isNotFound(error)) return { ok: true, state: { kind: 'absent' } }
    if (errorCode(error) === 'ENOTDIR') {
      return { ok: false, failure: { reason: 'parent-unusable', path, component: path } }
    }
    return unreadable(path, error)
  }

  const linkKind = unsupportedKind(linkStats)
  if (linkKind !== null) {
    return { ok: false, failure: { reason: 'unsupported-object', path, objectKind: linkKind } }
  }

  let fd: number
  try {
    fd = sys.openRead(path)
  } catch (error) {
    // Vanished between the two calls: absence is the honest answer, and the
    // mutation's own precondition check rejects it if absence is wrong.
    if (isNotFound(error)) return { ok: true, state: { kind: 'absent' } }
    const code = errorCode(error)
    // ELOOP from O_NOFOLLOW means the name became a symlink after the lstat.
    if (code === 'ELOOP') return { ok: false, failure: { reason: 'unsupported-object', path, objectKind: 'symlink' } }
    if (code === 'ENOTDIR') return { ok: false, failure: { reason: 'parent-unusable', path, component: path } }
    return unreadable(path, error)
  }

  try {
    const stats = sys.fstat(fd)
    const kind = unsupportedKind(stats)
    if (kind !== null) {
      return { ok: false, failure: { reason: 'unsupported-object', path, objectKind: kind } }
    }
    return { ok: true, state: regularFile(sys.readFd(fd), stats.mode & FILE_MODE_MASK) }
  } catch (error) {
    return unreadable(path, error)
  } finally {
    try {
      sys.close(fd)
    } catch {
      // A descriptor already read from. Failing here would discard bytes we
      // successfully obtained, and there is nothing a caller could do about it.
    }
  }
}

/** One-line rendering of an inspection failure, for logs and diagnostics. */
export function describeInspectFailure(failure: InspectFileFailure): string {
  switch (failure.reason) {
    case 'unsupported-object':
      return `${failure.path} is a ${failure.objectKind}, which this operation will not write through`
    case 'symlinked-ancestor':
      return `${failure.path} is reached through a symlinked directory (${failure.component})`
    case 'parent-unusable':
      return `${failure.path} has a parent component that is not a directory (${failure.component})`
    case 'unreadable':
      return `${failure.path} could not be read: ${failure.message}`
  }
}
