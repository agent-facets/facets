import { readFileSync, rmSync, writeFileSync } from 'node:fs'

/**
 * Byte preimages: the engine's own record of what a file looked like before
 * it touched it.
 *
 * Used wherever a rollback has to put bytes back exactly — the project-file
 * trio, and every native configuration document an adapter discloses. It is
 * one module rather than one copy per call site because the rule that makes
 * it safe is subtle and asymmetric: getting "the file is absent" wrong in one
 * direction loses a file, and in the other leaves one behind.
 *
 * Deliberately not in `@agent-facets/common`: only the engine rolls back.
 * Adapters supply no inverse operations at all.
 */

/**
 * A file's prior state.
 *
 * Tagged rather than `bytes: Buffer | null`, because `null` is doing real
 * work here — it means "restore by deleting" — and a nullable field invites a
 * caller to reach for `.bytes` and write `null` into a file.
 */
export type FilePreimage = { kind: 'absent'; path: string } | { kind: 'present'; path: string; bytes: Buffer }

export type CapturePreimageResult = { ok: true; preimage: FilePreimage } | { ok: false; cause: string }

export type RestorePreimageResult = { ok: true } | { ok: false; cause: string }

/**
 * Read a file's current bytes, or record that it does not exist.
 *
 * Only the "not there" errno family counts as absence. Every other read
 * failure — EACCES, EIO, a path that turned into a directory — is reported,
 * because treating it as absence would arm a restore that DELETES a file this
 * run could not read, turning an unreadable document into a lost one.
 */
export function capturePreimage(path: string): CapturePreimageResult {
  try {
    return { ok: true, preimage: { kind: 'present', path, bytes: readFileSync(path) } }
  } catch (error) {
    if (isMissingFile(error)) return { ok: true, preimage: { kind: 'absent', path } }
    return { ok: false, cause: `could not read the current contents: ${describeError(error)}` }
  }
}

/**
 * Put a file back exactly as it was, or report why it could not be.
 *
 * Returns rather than throws so each caller can choose: the tri-write's
 * restore is best-effort (it runs on a disk that just failed a write, and a
 * structured failure already reports the commit as failed), while a journal
 * inverse must convert a failure into a throw — the journal counts an undo as
 * failed only when it throws, so a swallowed restore would be reported as a
 * clean rollback while a document stayed changed.
 */
export function restorePreimage(preimage: FilePreimage): RestorePreimageResult {
  try {
    if (preimage.kind === 'absent') {
      rmSync(preimage.path, { force: true })
    } else {
      writeFileSync(preimage.path, preimage.bytes)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, cause: describeError(error) }
  }
}

/**
 * Whether a file still matches its preimage.
 *
 * Lets a caller arm a restore for a document that may never be written without
 * paying for a rewrite — and, more usefully, without changing the file's
 * modification time and waking a tool that watches its own configuration.
 * An unreadable file is reported as differing, so the restore still runs and
 * either succeeds or reports its own failure.
 */
export function matchesPreimage(preimage: FilePreimage): boolean {
  try {
    const bytes = readFileSync(preimage.path)
    return preimage.kind === 'present' && bytes.equals(preimage.bytes)
  } catch (error) {
    if (isMissingFile(error)) return preimage.kind === 'absent'
    return false
  }
}

/** ENOENT/ENOTDIR — the "file is not there" errno family. */
export function isMissingFile(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
