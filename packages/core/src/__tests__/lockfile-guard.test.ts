import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireInstallLock } from '../install/lockfile-guard.ts'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'install-lock-test-'))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('acquireInstallLock', () => {
  test('creates .facets/.install.lock and succeeds on first acquire', () => {
    const result = acquireInstallLock(projectRoot)
    expect(result.ok).toBe(true)
    expect(existsSync(join(projectRoot, '.facets/.install.lock'))).toBe(true)
    if (result.ok) {
      const raw = readFileSync(join(projectRoot, '.facets/.install.lock'), 'utf8')
      expect(JSON.parse(raw).pid).toBe(process.pid)
    }
  })

  test('release removes the lock file', async () => {
    const result = acquireInstallLock(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      await result.lock.release()
      expect(existsSync(join(projectRoot, '.facets/.install.lock'))).toBe(false)
    }
  })

  test('second acquire fails with EEXIST when the pid is live', () => {
    const first = acquireInstallLock(projectRoot)
    expect(first.ok).toBe(true)
    const second = acquireInstallLock(projectRoot)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.heldByPid).toBe(process.pid)
      expect(second.path).toContain('.install.lock')
    }
  })

  test('stale lock (dead pid) is overwritten on retry', () => {
    // A dead-pid stand-in: pid 99999 is highly unlikely to be alive as a
    // real user process. process.kill(pid, 0) will fail with ESRCH.
    const deadPid = 99999
    mkdirSync(join(projectRoot, '.facets'), { recursive: true })
    const lockPath = join(projectRoot, '.facets/.install.lock')
    writeFileSync(lockPath, JSON.stringify({ pid: deadPid, acquiredAt: new Date().toISOString() }), 'utf8')

    const result = acquireInstallLock(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const raw = readFileSync(lockPath, 'utf8')
      expect(JSON.parse(raw).pid).toBe(process.pid)
    }
  })
})
