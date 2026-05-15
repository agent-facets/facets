import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { acquireInstallLock, computeLockPath } from '../lockfile-guard.ts'

let projectRoot: string
let facetDir: string
let originalFacetDir: string | undefined

beforeEach(() => {
  // Both `projectRoot` and `facetDir` are realpath-canonicalized so the
  // hash inside the lock filename matches what the lock guard computes
  // internally via `realpathSync(projectRoot)`. Otherwise macOS's
  // `/tmp` → `/private/tmp` symlink would make the test's expected hash
  // and the implementation's hash diverge.
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'install-lock-test-')))
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'install-lock-facet-dir-')))
  originalFacetDir = process.env.FACET_DIR
  process.env.FACET_DIR = facetDir
})

afterEach(() => {
  if (originalFacetDir === undefined) {
    delete process.env.FACET_DIR
  } else {
    process.env.FACET_DIR = originalFacetDir
  }
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(facetDir, { recursive: true, force: true })
})

describe('acquireInstallLock', () => {
  test('creates the lock file under $FACET_DIR/locks/ and succeeds on first acquire', () => {
    const result = acquireInstallLock(projectRoot)
    expect(result.ok).toBe(true)
    const lockPath = computeLockPath(projectRoot)
    // Lock file lives under $FACET_DIR/locks/, NOT in the project root.
    expect(lockPath.startsWith(`${join(facetDir, 'locks')}/`)).toBe(true)
    expect(lockPath.endsWith('.lock')).toBe(true)
    expect(existsSync(lockPath)).toBe(true)
    // The project root must be untouched — no facet state next to facets.json.
    expect(existsSync(join(projectRoot, '.facet.lock'))).toBe(false)
    expect(existsSync(join(projectRoot, '.facets'))).toBe(false)
    if (result.ok) {
      const raw = readFileSync(lockPath, 'utf8')
      expect(JSON.parse(raw).pid).toBe(process.pid)
    }
  })

  test('release removes the lock file but leaves $FACET_DIR/locks/ in place', async () => {
    const result = acquireInstallLock(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const lockPath = computeLockPath(projectRoot)
      await result.lock.release()
      expect(existsSync(lockPath)).toBe(false)
      // The locks/ directory persists across runs.
      expect(existsSync(dirname(lockPath))).toBe(true)
    }
  })

  test('second acquire fails with EEXIST when the pid is live', () => {
    const first = acquireInstallLock(projectRoot)
    expect(first.ok).toBe(true)
    const second = acquireInstallLock(projectRoot)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.heldByPid).toBe(process.pid)
      expect(second.path).toBe(computeLockPath(projectRoot))
    }
  })

  test('two different project roots get distinct locks under $FACET_DIR/locks/', () => {
    const otherProject = realpathSync(mkdtempSync(join(tmpdir(), 'install-lock-test-other-')))
    try {
      const a = acquireInstallLock(projectRoot)
      const b = acquireInstallLock(otherProject)
      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
      const aPath = computeLockPath(projectRoot)
      const bPath = computeLockPath(otherProject)
      expect(aPath).not.toBe(bPath)
      expect(existsSync(aPath)).toBe(true)
      expect(existsSync(bPath)).toBe(true)
    } finally {
      rmSync(otherProject, { recursive: true, force: true })
    }
  })

  test('stale lock (dead pid) is overwritten on retry', () => {
    // A dead-pid stand-in: pid 99999 is highly unlikely to be alive as a
    // real user process. process.kill(pid, 0) will fail with ESRCH.
    const deadPid = 99999
    const lockPath = computeLockPath(projectRoot)
    // Acquire and release so the locks/ directory exists, then write our
    // stale stand-in lock file. Manually creating the locks/ dir would
    // work too; this path also exercises that release leaves the dir.
    const seed = acquireInstallLock(projectRoot)
    expect(seed.ok).toBe(true)
    if (seed.ok) {
      // Release synchronously by overwriting the lock contents with a
      // stale pid — the rm in release is async and we don't want to wait.
      writeFileSync(lockPath, JSON.stringify({ pid: deadPid, acquiredAt: new Date().toISOString() }), 'utf8')
    }

    const result = acquireInstallLock(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const raw = readFileSync(lockPath, 'utf8')
      expect(JSON.parse(raw).pid).toBe(process.pid)
    }
  })

  // EPERM regression: `process.kill(pid, 0)` returns EPERM (not ESRCH)
  // when the target process exists but the caller cannot signal it
  // (e.g., owned by a different UID). The previous implementation
  // collapsed all errors to "dead" and would steal a live lock.
  //
  // We use pid 1 (init/launchd on macOS, init/systemd on Linux). A
  // non-root user attempting to signal it gets EPERM. Root would get
  // success, so this test must be skipped when running as root.
  // Windows has different signal semantics — skip there too.
  const skipEperm = process.platform === 'win32' || process.getuid?.() === 0
  test.skipIf(skipEperm)('lock with EPERM-mapped pid is treated as alive (not stolen)', () => {
    // pid 1 is alive on POSIX systems; non-root sees EPERM on probe.
    const epermPid = 1
    const lockPath = computeLockPath(projectRoot)
    // Seed the locks/ directory then plant the EPERM-pid lock.
    const seed = acquireInstallLock(projectRoot)
    expect(seed.ok).toBe(true)
    writeFileSync(lockPath, JSON.stringify({ pid: epermPid, acquiredAt: new Date().toISOString() }), 'utf8')

    const result = acquireInstallLock(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.heldByPid).toBe(epermPid)
    // The lock file must NOT have been overwritten with our pid.
    const raw = readFileSync(lockPath, 'utf8')
    expect(JSON.parse(raw).pid).toBe(epermPid)
  })
})

describe('computeLockPath', () => {
  test('produces a deterministic path keyed by realpath(projectRoot)', () => {
    const a = computeLockPath(projectRoot)
    const b = computeLockPath(projectRoot)
    expect(a).toBe(b)
  })

  test('includes a sanitized basename for human grep-ability', () => {
    const lockPath = computeLockPath(projectRoot)
    const filename = lockPath.split('/').pop() ?? ''
    // Format: <basename>-<16-hex>.lock
    expect(filename).toMatch(/^[A-Za-z0-9_-]+-[0-9a-f]{16}\.lock$/)
  })
})
