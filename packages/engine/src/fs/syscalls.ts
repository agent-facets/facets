import { constants, fchmodSync, mkdirSync, openSync, renameSync, rmdirSync, unlinkSync, writeSync } from 'node:fs'
import { errorCode, errorMessage, type FileReadSyscalls, nodeFileReadSyscalls } from '@agent-facets/common'

/**
 * The complete set of filesystem operations the transaction performs.
 *
 * It extends the shared read-only surface rather than restating it, so an
 * adapter planning a change and the engine performing it read a file the same
 * way. The mutating half lives here alone: only the engine writes.
 *
 * It exists as an injectable record for one reason: the guarantees this
 * transaction makes are about what happens when a syscall fails *at a specific
 * moment* — a rename that lands and then reports an error, a file that changes
 * between the batch preflight and its own mutation, a restore that hits EIO.
 * None of those are reachable from a test that can only touch real files, and
 * a guarantee no test can falsify is not a guarantee.
 *
 * Injected as a parameter rather than mocked at the module boundary so one test
 * file can mix real and faulted operations, and so production code has a single
 * obvious default.
 *
 * Every operation is synchronous. The transaction's ordering rules — arm, then
 * mutate, then verify — are about the sequence of syscalls, and interleaving
 * would make them unprovable.
 */
export interface FsSyscalls extends FileReadSyscalls {
  /** Create a brand-new file, failing if the name exists or is a symlink. */
  openExclusive(path: string, mode: number): number
  writeFd(fd: number, data: Uint8Array): void
  fchmod(fd: number, mode: number): void
  rename(from: string, to: string): void
  unlink(path: string): void
  /** Non-recursive. Recursive creation would hide which components we made. */
  mkdir(path: string): void
  /** Non-recursive. This is load-bearing: `rmdir` cannot remove a non-empty directory. */
  rmdir(path: string): void
}

/**
 * `O_EXCL` makes the staged name's uniqueness a kernel-enforced fact rather
 * than a probability; `O_NOFOLLOW` refuses to create through a symlink someone
 * planted at that name.
 */
const NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0

/** Mode requested for a newly created file. The process umask narrows it. */
export const DEFAULT_NEW_FILE_MODE = 0o666

export const nodeFsSyscalls: FsSyscalls = {
  ...nodeFileReadSyscalls,
  openExclusive: (path, mode) =>
    openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, mode),
  writeFd: (fd, data) => {
    let written = 0
    while (written < data.byteLength) {
      written += writeSync(fd, data, written, data.byteLength - written)
    }
  },
  fchmod: (fd, mode) => fchmodSync(fd, mode),
  rename: (from, to) => renameSync(from, to),
  unlink: (path) => unlinkSync(path),
  mkdir: (path) => mkdirSync(path),
  rmdir: (path) => rmdirSync(path),
}

/** Which syscall a failure came from. Named so a report can say what broke. */
export type FileOperation = 'create-directory' | 'stage' | 'write' | 'chmod' | 'commit' | 'delete'

/**
 * A syscall that failed, as data.
 *
 * `code` is optional because not every thrown value carries an errno, and
 * inventing one would let a caller branch on a fiction.
 */
export interface FileOperationFailure {
  readonly operation: FileOperation
  readonly path: string
  readonly code?: string
  readonly message: string
}

export function operationFailure(operation: FileOperation, path: string, error: unknown): FileOperationFailure {
  const code = errorCode(error)
  return code === undefined
    ? { operation, path, message: errorMessage(error) }
    : { operation, path, code, message: errorMessage(error) }
}
