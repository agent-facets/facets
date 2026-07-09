import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { facetLocksDir } from '../facet-dir.ts'
import { jsonFileText } from '../json-file-text.ts'

/**
 * Atomic parallel-install advisory lock (Adjustment H + U).
 *
 * Creates a lock file under `$FACET_DIR/locks/<basename>-<sha16>.lock`
 * with `O_CREAT|O_EXCL` (Node's `'wx'` flag) so only one process can
 * acquire it for a given project. On EEXIST we read the held pid and
 * check liveness — if the holding process is dead the lock is treated
 * as stale and retried once.
 *
 * The lock file lives under the centralized facet directory tree, not
 * in the project root. This keeps the project root completely clean of
 * facet-managed state — `facet install` never materializes any file or
 * directory next to `facets.json`.
 *
 * Lock filenames are derived from `realpath(projectRoot)`:
 * `<sanitized-basename>-<sha256(realpath)[:16]>.lock`. The basename is
 * for human grep-ability when debugging; the hash is the uniqueness
 * guarantee. Two checkouts of the same repo at different paths (git
 * worktrees, Conductor workspaces) hash differently and get distinct
 * locks — correct behavior, since they are independent installs.
 */

/**
 * Sanitize a path basename for use as a filename: replace any character
 * outside `[A-Za-z0-9_-]` with `-`. Empty result (e.g., basename of a
 * root path) falls back to `root`.
 */
function sanitizeBasename(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9_-]/g, '-')
  return cleaned.length > 0 ? cleaned : 'root'
}

/**
 * Compute the absolute path to the lock file for a given project root.
 * Pure (modulo `realpathSync`); no directory creation.
 */
export function computeLockPath(projectRoot: string): string {
  let realRoot: string
  try {
    realRoot = realpathSync(projectRoot)
  } catch {
    // realpath fails if the project root doesn't exist or isn't
    // accessible. Fall back to the input path — locking still works,
    // but two equivalent paths that haven't been canonicalized may not
    // dedupe. That's an edge case we accept; the install will fail for
    // other reasons before the lock matters in this scenario.
    realRoot = projectRoot
  }
  const base = sanitizeBasename(basename(realRoot))
  const hash = createHash('sha256').update(realRoot).digest('hex').slice(0, 16)
  return join(facetLocksDir(), `${base}-${hash}.lock`)
}

export interface InstallLock {
  /** Release the lock. Idempotent. */
  release(): Promise<void>
}

export interface AcquireLockError {
  ok: false
  heldByPid: number
  path: string
}

export type AcquireLockResult = { ok: true; lock: InstallLock } | AcquireLockError

export function acquireInstallLock(projectRoot: string): AcquireLockResult {
  const path = computeLockPath(projectRoot)
  // Ensure $FACET_DIR/locks/ exists. Lazy — first acquire creates it,
  // subsequent ones reuse it. The directory is intentionally not removed
  // on release; it persists across runs as part of the facet directory
  // tree.
  mkdirSync(facetLocksDir(), { recursive: true })

  const contents = jsonFileText({ pid: process.pid, acquiredAt: new Date().toISOString() })

  try {
    const fd = openSync(path, 'wx')
    writeFileSync(fd, contents, 'utf8')
    closeSync(fd)
    return { ok: true, lock: makeLock(path) }
  } catch (err) {
    if (!isEexist(err)) throw err
  }

  // Stale-pid retry: read the existing lock, check liveness, remove if dead.
  // F3 — the retry must preserve the O_CREAT|O_EXCL invariant so two
  // processes that both observe the stale pid can't both "acquire". Unlink
  // first, then re-attempt with `wx`. A racing cleaner that wins the unlink
  // will see EEXIST on our openSync and fall through to the "held" return.
  const held = readHeldPid(path)
  if (held !== null && !isProcessAlive(held)) {
    try {
      unlinkSync(path)
    } catch {
      // Another cleaner may have removed it first; proceed to the openSync
      // attempt either way and let its EEXIST handling decide.
    }
    try {
      const fd = openSync(path, 'wx')
      writeFileSync(fd, contents, 'utf8')
      closeSync(fd)
      return { ok: true, lock: makeLock(path) }
    } catch (err) {
      if (!isEexist(err)) throw err
    }
  }

  return { ok: false, heldByPid: held ?? -1, path }
}

function makeLock(path: string): InstallLock {
  let released = false
  return {
    async release() {
      if (released) return
      released = true
      await rm(path, { force: true }).catch(() => {})
    },
  }
}

function readHeldPid(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as { pid?: unknown }
    return typeof parsed.pid === 'number' ? parsed.pid : null
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // `process.kill(pid, 0)` is a probe — it doesn't deliver a signal,
    // it asks the kernel whether the call would have been accepted.
    // The errno tells us *why* it wasn't:
    //   - ESRCH: no process with that pid → safe to treat as dead.
    //   - EPERM: the process exists, we just can't signal it (different
    //     UID, sandboxed, etc.) → assume alive; do NOT steal the lock.
    //   - anything else: unknown failure mode → assume alive (fail safe).
    // The previous `catch {}` collapsed all errors to "dead", which let
    // a second installer in a shared workspace unlink a live lock.
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    return code !== 'ESRCH'
  }
}

function isEexist(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'EEXIST'
}
