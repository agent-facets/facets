import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Atomic parallel-install advisory lock (Adjustment H + U).
 *
 * Creates `<projectRoot>/.facets/.install.lock` with `O_CREAT|O_EXCL`
 * (Node's `'wx'` flag) so only one process can acquire it. On EEXIST we
 * read the held pid and check liveness — if the holding process is dead
 * the lock is treated as stale and retried once.
 */

const LOCK_PATH = '.facets/.install.lock'

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
  const path = join(projectRoot, LOCK_PATH)
  mkdirSync(dirname(path), { recursive: true })

  const contents = JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })

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
