import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { getEventListeners } from 'node:events'
import * as fs from 'node:fs'
import {
  type BigIntStats,
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type StatOptions,
  type Stats,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  deleteOAuthSession,
  isOAuthStorePlatformSupported,
  type OAuthSession,
  type OAuthSessionBinding,
  type OAuthStoreOptions,
  type OAuthStoreResult,
  type ReadyOAuthSession,
  readOAuthSession,
  readOAuthSessionForLocalCleanup,
  saveOAuthSession,
  type UncertainOAuthSession,
  withOAuthSessionLock,
} from '../oauth-store.ts'

const binding = {
  registry_origin: 'https://registry.example.test',
  client_id: 'client_public_123',
  issuer: 'https://login.example.test',
  authorization_endpoint: 'https://login.example.test/oauth/authorize',
  token_endpoint: 'https://login.example.test/oauth/token',
  verification_origin: 'https://login.example.test',
} satisfies OAuthSessionBinding

let facetDir: string
let options: OAuthStoreOptions

beforeEach(() => {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('OAuth store tests require a POSIX host')
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'oauth-store-')))
  chmodSync(facetDir, 0o700)
  options = {
    platform: process.platform,
    resolveFacetDir: () => facetDir,
    ownerUid: uid,
    lockTimeoutMs: 2_000,
    lockPollMs: 5,
  }
})

afterEach(() => {
  rmSync(facetDir, { recursive: true, force: true })
})

describe('platform support', () => {
  test('supports only macOS and Linux', () => {
    expect(isOAuthStorePlatformSupported('darwin')).toBe(true)
    expect(isOAuthStorePlatformSupported('linux')).toBe(true)
    expect(isOAuthStorePlatformSupported('win32')).toBe(false)
    expect(isOAuthStorePlatformSupported('freebsd')).toBe(false)
  })

  test('returns the fixed unsupported result before resolving any filesystem path', async () => {
    let resolutions = 0
    let filesystemChecks = 0
    const unsupported: OAuthStoreOptions = {
      platform: 'win32',
      resolveFacetDir: () => {
        resolutions += 1
        return join(facetDir, 'must-not-be-used')
      },
      statfs: async () => {
        filesystemChecks += 1
        return { type: 0n }
      },
    }

    const read = await readOAuthSession(binding, unsupported)
    expectUnsupported(read)
    const locked = await withOAuthSessionLock(binding, async () => ok(undefined), unsupported)
    expectUnsupported(locked)
    expect(resolutions).toBe(0)

    const result = await withOAuthSessionLock(
      binding,
      async (lock) => {
        const saved = await saveOAuthSession(readySession(1), null, lock, { platform: 'win32' })
        expectUnsupported(saved)
        const deleted = await deleteOAuthSession(binding, null, lock, { platform: 'win32' })
        expectUnsupported(deleted)
        return ok(undefined)
      },
      options,
    )
    unwrap(result)
    expect(filesystemChecks).toBe(0)
  })

  test('rejects known Linux network filesystems and classifies statfs failure', async () => {
    const network = await withOAuthSessionLock(binding, async () => ok(undefined), {
      ...options,
      platform: 'linux',
      statfs: async () => ({ type: 0x6969n }),
    })
    if (network.ok) expect.unreachable('NFS unexpectedly accepted')
    expect(network.error).toEqual({
      code: 'UNSUPPORTED_FILESYSTEM',
      path: join(facetDir, 'oauth'),
      filesystem_type: '0x6969',
      guidance: 'Browser login requires a local filesystem for OAuth state.',
    })

    const failed = await readOAuthSession(binding, {
      ...options,
      statfs: async () => {
        throw new Error('statfs unavailable')
      },
    })
    if (failed.ok) expect.unreachable('statfs failure unexpectedly accepted')
    expect(failed.error.code).toBe('IO_ERROR')
    if (failed.error.code !== 'IO_ERROR') expect.unreachable('unexpected statfs failure')
    expect(failed.error.operation).toBe('inspect filesystem')
  })

  test('does not claim unknown macOS filesystem types are proven local', async () => {
    const result = await withOAuthSessionLock(binding, async () => ok(undefined), {
      ...options,
      platform: 'darwin',
      statfs: async () => ({ type: 0xdeadbeefn }),
    })
    unwrap(result)
  })
})

describe('session persistence', () => {
  test('offline cleanup read validates selected origin and the full protected state', async () => {
    await save(readySession(1), null)
    expect(unwrap(await readOAuthSessionForLocalCleanup(binding.registry_origin, options))).toEqual(readySession(1))
    expect(unwrap(await readOAuthSessionForLocalCleanup('https://other-registry.example.test', options))).toBeNull()

    const wrongOrigin = { ...readySession(1), registry_origin: 'https://other-registry.example.test' }
    writeFileSync(statePath(), `${JSON.stringify(wrongOrigin)}\n`, { mode: 0o600 })
    const rejected = await readOAuthSessionForLocalCleanup(binding.registry_origin, options)
    if (rejected.ok) expect.unreachable('wrong-origin state accepted')
    expect(rejected.error.code).toBe('INVALID_SESSION')
    expect(existsSync(statePath())).toBe(true)

    const invalidOrigin = await readOAuthSessionForLocalCleanup('http://registry.example.test', options)
    if (invalidOrigin.ok) expect.unreachable('insecure origin accepted')
    expect(invalidOrigin.error.code).toBe('INVALID_BINDING')
  })

  test('offline cleanup read rejects symlinks, wrong owner, and malformed state', async () => {
    const outside = join(facetDir, 'outside.json')
    writeFileSync(outside, `${JSON.stringify(readySession(1))}\n`, { mode: 0o600 })
    mkdirSync(join(facetDir, 'oauth'), { mode: 0o700 })
    symlinkSync(outside, statePath())
    expectUnsafe(await readOAuthSessionForLocalCleanup(binding.registry_origin, options), 'symlink')

    rmSync(statePath())
    writeFileSync(statePath(), `${JSON.stringify(readySession(1))}\n`, { mode: 0o600 })
    expectUnsafe(
      await readOAuthSessionForLocalCleanup(binding.registry_origin, {
        ...options,
        lstat: wrongOwnerLstat(statePath()),
      }),
      'wrong-owner',
    )
    writeFileSync(statePath(), '{broken-json\n', { mode: 0o600 })
    const malformed = await readOAuthSessionForLocalCleanup(binding.registry_origin, options)
    if (malformed.ok) expect.unreachable('malformed state accepted')
    expect(malformed.error.code).toBe('INVALID_SESSION')
  })

  test('offline cleanup candidate cannot delete a later replacement generation', async () => {
    await save(readySession(1), null)
    const candidate = unwrap(await readOAuthSessionForLocalCleanup(binding.registry_origin, options))
    if (candidate === null) expect.unreachable('missing cleanup candidate')
    await save(readySession(2), 1)
    const replacement = readFileSync(statePath(), 'utf8')
    const staleDelete = await withOAuthSessionLock(
      binding,
      (lock) => deleteOAuthSession(binding, candidate.generation, lock),
      options,
    )
    if (staleDelete.ok) expect.unreachable('stale cleanup deleted replacement')
    expect(staleDelete.error.code).toBe('GENERATION_CONFLICT')
    expect(readFileSync(statePath(), 'utf8')).toBe(replacement)
  })

  test('writes a registry-keyed owner-only session and verifies its current binding', async () => {
    await save(readySession(1), null)

    const root = join(facetDir, 'oauth')
    const state = statePath()
    expect(lstatSync(root).mode & 0o777).toBe(0o700)
    expect(lstatSync(state).mode & 0o777).toBe(0o600)
    expect(state).toBe(join(root, `${createHash('sha256').update(binding.registry_origin).digest('hex')}.json`))
    expect(unwrap(await readOAuthSession(binding, options))).toEqual(readySession(1))

    const changed = { ...binding, client_id: 'different-client' }
    const mismatch = await readOAuthSession(changed, options)
    if (mismatch.ok) expect.unreachable('binding mismatch unexpectedly succeeded')
    expect(mismatch.error.code).toBe('INVALID_SESSION')
  })

  test('rejects every lock-binding mismatch before an initial or replacement mutation', async () => {
    const mismatches = [
      ['registry_origin', 'https://other-registry.example.test'],
      ['client_id', 'different-client'],
      ['issuer', 'https://other-login.example.test'],
      ['authorization_endpoint', 'https://login.example.test/oauth/other-authorize'],
      ['token_endpoint', 'https://login.example.test/oauth/other-token'],
      ['verification_origin', 'https://other-login.example.test'],
    ] satisfies ReadonlyArray<readonly [keyof OAuthSessionBinding, string]>

    for (const [field, value] of mismatches) {
      const rejected = await withOAuthSessionLock(
        binding,
        (lock) => saveOAuthSession({ ...readySession(1), [field]: value }, null, lock),
        options,
      )
      expectBindingMismatch(rejected, field)
      expect(existsSync(statePath())).toBe(false)
    }

    await save(readySession(1), null)
    const original = readFileSync(statePath(), 'utf8')
    for (const [field, value] of mismatches) {
      const rejected = await withOAuthSessionLock(
        binding,
        (lock) => saveOAuthSession({ ...readySession(2), [field]: value }, 1, lock),
        options,
      )
      expectBindingMismatch(rejected, field)
      expect(readFileSync(statePath(), 'utf8')).toBe(original)

      const rejectedDelete = await withOAuthSessionLock(
        binding,
        (lock) => deleteOAuthSession({ ...binding, [field]: value }, 1, lock),
        options,
      )
      if (rejectedDelete.ok) expect.unreachable(`${field} mismatch unexpectedly deleted state`)
      expect(rejectedDelete.error.code).toBe('LOCK_LOST')
      expect(readFileSync(statePath(), 'utf8')).toBe(original)
    }
  })

  test('validates retry metadata as a status-dependent persistent fence', async () => {
    const missingMetadata = { ...readySession(1), status: 'uncertain' }
    const readyWithMetadata = { ...readySession(1), refresh_started_at: Date.now(), refresh_attempts: 1 }
    const tooManyAttempts = { ...uncertainSession(1, 1), refresh_attempts: 4 }
    const infiniteStart = { ...uncertainSession(1, 1), refresh_started_at: Number.POSITIVE_INFINITY }

    unwrap(await readOAuthSession(binding, options))
    for (const invalid of [missingMetadata, readyWithMetadata, tooManyAttempts, infiniteStart]) {
      writeFileSync(statePath(), `${JSON.stringify(invalid)}\n`, { mode: 0o600 })
      chmodSync(statePath(), 0o600)
      const result = await readOAuthSession(binding, options)
      if (result.ok) expect.unreachable('invalid retry metadata unexpectedly persisted')
      expect(result.error.code).toBe('INVALID_SESSION')
    }

    rmSync(statePath())
    await save(readySession(1), null)
    await save(uncertainSession(2, 1), 1)
    const first = unwrap(await readOAuthSession(binding, options))
    expect(first?.status).toBe('uncertain')
    if (first?.status !== 'uncertain') expect.unreachable('uncertain session was not preserved')
    expect(first.refresh_attempts).toBe(1)

    const reset = await withOAuthSessionLock(
      binding,
      (lock) =>
        saveOAuthSession(
          { ...first, generation: 3, refresh_started_at: first.refresh_started_at + 1, refresh_attempts: 2 },
          2,
          lock,
        ),
      options,
    )
    if (reset.ok) expect.unreachable('refresh timestamp reset unexpectedly persisted')
    expect(reset.error.code).toBe('INVALID_SESSION')

    await save({ ...first, generation: 3, refresh_attempts: 2 }, 2)
    const second = unwrap(await readOAuthSession(binding, options))
    if (second?.status !== 'uncertain') expect.unreachable('uncertain retry was not preserved')
    expect(second.refresh_started_at).toBe(first.refresh_started_at)
    expect(second.refresh_attempts).toBe(2)
  })

  test('rejects malformed JSON, unknown versions, and invalid payloads', async () => {
    unwrap(await readOAuthSession(binding, options))
    for (const contents of [
      '{',
      `${JSON.stringify({ ...readySession(1), version: 2 })}\n`,
      `${JSON.stringify({ ...readySession(1), access_token: '' })}\n`,
      `${JSON.stringify({ ...readySession(1), unexpected: true })}\n`,
    ]) {
      writeFileSync(statePath(), contents, { mode: 0o600 })
      chmodSync(statePath(), 0o600)
      const result = await readOAuthSession(binding, options)
      if (result.ok) expect.unreachable('invalid state unexpectedly loaded')
      expect(result.error.code).toBe('INVALID_SESSION')
    }
  })

  test('rejects symlinks, wrong kinds, insecure permissions, and wrong owners', async () => {
    const outside = join(facetDir, 'outside.json')
    writeFileSync(outside, `${JSON.stringify(readySession(1))}\n`, { mode: 0o600 })
    mkdirSync(join(facetDir, 'oauth'), { mode: 0o700 })
    symlinkSync(outside, statePath())
    expectUnsafe(await readOAuthSession(binding, options), 'symlink')

    rmSync(statePath())
    mkdirSync(statePath())
    expectUnsafe(await readOAuthSession(binding, options), 'wrong-kind')

    rmSync(statePath(), { recursive: true })
    writeFileSync(statePath(), `${JSON.stringify(readySession(1))}\n`, { mode: 0o644 })
    expectUnsafe(await readOAuthSession(binding, options), 'insecure-permissions')

    chmodSync(statePath(), 0o600)
    const uid = process.getuid?.()
    if (uid === undefined) throw new Error('OAuth store tests require a POSIX host')
    const wrongOwner = await readOAuthSession(binding, { ...options, ownerUid: uid + 1 })
    expectUnsafe(wrongOwner, 'wrong-owner')
  })

  test('rejects an unsafe OAuth directory before reading state', async () => {
    mkdirSync(join(facetDir, 'oauth'), { mode: 0o755 })
    expectUnsafe(await readOAuthSession(binding, options), 'insecure-permissions')
  })

  test('preserves old bytes on failed generations and replaces atomically without residue', async () => {
    await save(readySession(1), null)
    const beforeBytes = readFileSync(statePath(), 'utf8')
    const beforeInode = lstatSync(statePath()).ino

    const stale = await withOAuthSessionLock(binding, (lock) => saveOAuthSession(readySession(2), 0, lock), options)
    if (stale.ok) expect.unreachable('stale generation unexpectedly persisted')
    expect(stale.error).toEqual({ code: 'GENERATION_CONFLICT', expected: 0, actual: 1 })
    expect(readFileSync(statePath(), 'utf8')).toBe(beforeBytes)

    await save(readySession(2), 1)
    expect(lstatSync(statePath()).ino).not.toBe(beforeInode)
    expect(unwrap(await readOAuthSession(binding, options))).toEqual(readySession(2))
    expect(readdirSync(join(facetDir, 'oauth')).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('deletes only under the lock and refuses a stale generation', async () => {
    await save(readySession(1), null)
    const stale = await withOAuthSessionLock(binding, (lock) => deleteOAuthSession(binding, 0, lock), options)
    expect(stale.ok).toBe(false)
    expect(existsSync(statePath())).toBe(true)

    const deleted = await withOAuthSessionLock(binding, (lock) => deleteOAuthSession(binding, 1, lock), options)
    expect(unwrap(deleted)).toBe(true)
    expect(unwrap(await readOAuthSession(binding, options))).toBeNull()
  })
})

describe('cross-process lock', () => {
  test('times out without stealing a live lock', async () => {
    const result = await withOAuthSessionLock(
      binding,
      async () => {
        const contender = await withOAuthSessionLock(binding, async () => ok(undefined), {
          ...options,
          lockTimeoutMs: 30,
          lockPollMs: 2,
        })
        if (contender.ok) expect.unreachable('contender unexpectedly acquired the lock')
        expect(contender.error.code).toBe('LOCK_TIMEOUT')
        return ok(undefined)
      },
      options,
    )
    unwrap(result)
  })

  test('releases its lock when the callback throws', async () => {
    await expect(
      withOAuthSessionLock(
        binding,
        async () => {
          throw new Error('callback failure')
        },
        options,
      ),
    ).rejects.toThrow('callback failure')
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
  })

  test('keeps a safe owner-only coordination database in DELETE journal mode', async () => {
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
    const path = lockPath()
    const stat = lstatSync(path)
    expect(stat.isFile()).toBe(true)
    expect(stat.mode & 0o777).toBe(0o600)
    expect(stat.nlink).toBe(1)

    const database = new Database(path, { create: false, readwrite: true, strict: true })
    try {
      expect(database.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()).toEqual({
        journal_mode: 'delete',
      })
    } finally {
      database.close(true)
    }
  })

  test('rejects unsafe coordination database types, permissions, and links', async () => {
    mkdirSync(join(facetDir, 'oauth'), { mode: 0o700 })
    const path = lockPath()
    const outside = join(facetDir, 'outside.sqlite')
    writeFileSync(outside, '', { mode: 0o600 })
    symlinkSync(outside, path)
    expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'symlink')

    rmSync(path)
    mkdirSync(path)
    expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'wrong-kind')

    rmSync(path, { recursive: true })
    writeFileSync(path, '', { mode: 0o644 })
    expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'insecure-permissions')

    chmodSync(path, 0o600)
    linkSync(path, `${path}.alias`)
    expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'multiple-links')
  })

  test('rejects unsafe SQLite sidecars without deleting them', async () => {
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
    for (const suffix of ['-journal', '-wal', '-shm']) {
      const sidecar = `${lockPath()}${suffix}`
      mkdirSync(sidecar)
      expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'wrong-kind')
      expect(existsSync(sidecar)).toBe(true)
      rmSync(sidecar, { recursive: true })

      writeFileSync(sidecar, '', { mode: 0o644 })
      expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'insecure-permissions')
      expect(existsSync(sidecar)).toBe(true)
      rmSync(sidecar)
    }

    const sidecar = `${lockPath()}-journal`
    const outside = join(facetDir, 'outside-sidecar')
    writeFileSync(outside, '', { mode: 0o600 })
    symlinkSync(outside, sidecar)
    expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'symlink')
    expect(existsSync(sidecar)).toBe(true)
    rmSync(sidecar)

    writeFileSync(sidecar, '', { mode: 0o600 })
    linkSync(sidecar, `${sidecar}.alias`)
    expectUnsafe(await withOAuthSessionLock(binding, async () => ok(undefined), options), 'multiple-links')
    expect(existsSync(sidecar)).toBe(true)
  })

  test('rejects wrong-owner coordination database and each sidecar before SQLite opens', async () => {
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
    const targets = [lockPath(), ...['-journal', '-wal', '-shm'].map((suffix) => `${lockPath()}${suffix}`)]

    for (const target of targets) {
      if (target !== lockPath()) writeFileSync(target, '', { mode: 0o600 })
      const result = await withOAuthSessionLock(binding, async () => ok(undefined), {
        ...options,
        lstat: wrongOwnerLstat(target),
      })
      expectUnsafe(result, 'wrong-owner')
      expect(existsSync(target)).toBe(true)
      if (target !== lockPath()) rmSync(target)
    }
  })

  test('retries a busy commit without rerunning the callback', async () => {
    const originalExec = Database.prototype.exec
    let commits = 0
    let callbacks = 0
    const exec = spyOn(Database.prototype, 'exec').mockImplementation(function (this: Database, sql) {
      if (sql === 'COMMIT' && commits++ === 0) throw new BusySqliteError()
      return originalExec.call(this, sql)
    })
    try {
      const result = await withOAuthSessionLock(
        binding,
        async () => {
          callbacks += 1
          return ok('done')
        },
        { ...options, lockPollMs: 1 },
      )
      expect(unwrap(result)).toBe('done')
      expect(callbacks).toBe(1)
      expect(commits).toBe(2)
    } finally {
      exec.mockRestore()
    }
  })

  test('retries one startup PRAGMA SQLITE_BUSY within the original lock deadline', async () => {
    let attempts = 0
    const query = spyOn(Database.prototype, 'query').mockImplementation(function (this: Database, sql): never {
      if (sql !== 'PRAGMA journal_mode') throw new Error('unexpected startup query')
      attempts++
      query.mockRestore()
      throw new BusySqliteError()
    })
    try {
      const result = await withOAuthSessionLock(binding, async () => ok('acquired'), {
        ...options,
        lockTimeoutMs: 100,
        lockPollMs: 1,
      })
      expect(unwrap(result)).toBe('acquired')
      expect(attempts).toBe(1)
    } finally {
      query.mockRestore()
    }
  })

  test('perpetual startup PRAGMA SQLITE_BUSY ends in structured lock timeout', async () => {
    let attempts = 0
    const query = spyOn(Database.prototype, 'query').mockImplementation(function (this: Database, sql): never {
      if (sql !== 'PRAGMA journal_mode') throw new Error('unexpected startup query')
      attempts++
      throw new BusySqliteError()
    })
    try {
      const result = await withOAuthSessionLock(binding, async () => ok('unreachable'), {
        ...options,
        lockTimeoutMs: 20,
        lockPollMs: 1,
      })
      if (result.ok) expect.unreachable('perpetual startup contention acquired lock')
      expect(result.error.code).toBe('LOCK_TIMEOUT')
      expect(attempts).toBeGreaterThan(1)
    } finally {
      query.mockRestore()
    }
  })

  test('permits exactly one holder across N=2 real processes', async () => {
    await runLockRace(2)
  })

  test('serializes 10N=20 real processes through concurrent first creation', async () => {
    await runLockRace(20)
    expect(lstatSync(lockPath()).mode & 0o777).toBe(0o600)
  })

  test('recovers after SIGKILL releases the operating-system lock', async () => {
    const holder = spawnLockHolder(false)
    await expectHolderReady(holder)
    holder.kill(9)
    expect(await holder.exited).not.toBe(0)
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
  })

  test('preserves uncertain refresh metadata when a holder is SIGKILLed', async () => {
    await save(readySession(1), null)
    const holder = spawnLockHolder(true)
    await expectHolderReady(holder)
    holder.kill(9)
    expect(await holder.exited).not.toBe(0)

    const resumed = unwrap(await withOAuthSessionLock(binding, async () => readOAuthSession(binding, options), options))
    if (resumed?.status !== 'uncertain') expect.unreachable('uncertain state was not recovered')
    expect(resumed.refresh_started_at).toBe(1_800_000_000_000)
    expect(resumed.refresh_attempts).toBe(1)
  })
})

function readySession(generation: number): ReadyOAuthSession {
  return {
    version: 1,
    ...binding,
    access_token: `access-${generation}`,
    refresh_token: `refresh-${generation}`,
    expires_at: 2_000_000_000_000,
    subject: 'user-subject',
    session_id: 'session-id',
    user_uuid: 'user-uuid',
    generation,
    status: 'ready',
  }
}

function uncertainSession(generation: number, attempts: 1 | 2 | 3): UncertainOAuthSession {
  return {
    ...readySession(generation),
    status: 'uncertain',
    refresh_started_at: 1_800_000_000_000,
    refresh_attempts: attempts,
  }
}

async function save(session: OAuthSession, expectedGeneration: number | null): Promise<void> {
  const result = await withOAuthSessionLock(
    binding,
    (lock) => saveOAuthSession(session, expectedGeneration, lock),
    options,
  )
  unwrap(result)
}

function statePath(): string {
  const hash = createHash('sha256').update(binding.registry_origin).digest('hex')
  return join(facetDir, 'oauth', `${hash}.json`)
}

function lockPath(): string {
  const hash = createHash('sha256').update(binding.registry_origin).digest('hex')
  return join(facetDir, 'oauth', `${hash}.lock.sqlite`)
}

function modulePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'oauth-store.ts')
}

function ok<T>(value: T): OAuthStoreResult<T> {
  return { ok: true, value }
}

function unwrap<T>(result: OAuthStoreResult<T>): T {
  if (!result.ok) expect.unreachable(`expected success, received ${result.error.code}`)
  return result.value
}

function expectUnsupported(result: OAuthStoreResult<unknown>): void {
  if (result.ok) expect.unreachable('unsupported platform unexpectedly succeeded')
  expect(result.error).toEqual({
    code: 'UNSUPPORTED_PLATFORM',
    platform: 'win32',
    guidance: 'Browser login is unavailable on this platform; use FACET_TOKEN or PAT login.',
  })
}

function expectUnsafe(
  result: OAuthStoreResult<unknown>,
  reason: 'symlink' | 'wrong-kind' | 'wrong-owner' | 'insecure-permissions' | 'multiple-links',
): void {
  if (result.ok) expect.unreachable('unsafe state unexpectedly loaded')
  expect(result.error.code).toBe('UNSAFE_STATE')
  if (result.error.code !== 'UNSAFE_STATE') expect.unreachable('unexpected failure code')
  expect(result.error.reason).toBe(reason)
}

function expectBindingMismatch(result: OAuthStoreResult<unknown>, field: keyof OAuthSessionBinding): void {
  if (result.ok) expect.unreachable(`${field} mismatch unexpectedly persisted`)
  expect(result.error.code).toBe('INVALID_SESSION')
  if (result.error.code !== 'INVALID_SESSION') expect.unreachable('unexpected binding mismatch error')
  expect(result.error.issues).toEqual([`${field} differs from current configuration`])
}

function wrongOwnerLstat(targetPath: string): NonNullable<OAuthStoreOptions['lstat']> {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('OAuth store tests require a POSIX host')
  return async (path) => {
    const metadata = await lstat(path)
    if (path === targetPath) metadata.uid = uid + 1
    return metadata
  }
}

async function runLockRace(count: number): Promise<void> {
  const sentinel = join(facetDir, 'exclusive-holder')
  const script = `
    const store = await import(process.env.OAUTH_STORE_MODULE)
    const fs = await import('node:fs/promises')
    const binding = JSON.parse(process.env.OAUTH_BINDING)
    const result = await store.withOAuthSessionLock(binding, async () => {
      let handle
      try {
        handle = await fs.open(process.env.OAUTH_SENTINEL, 'wx', 0o600)
        await new Promise((resolve) => setTimeout(resolve, 15))
        return { ok: true, value: 1 }
      } finally {
        await handle?.close()
        if (handle) await fs.rm(process.env.OAUTH_SENTINEL, { force: true })
      }
    }, { lockTimeoutMs: 5000, lockPollMs: 2 })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    process.stdout.write('ok')
  `
  const children = Array.from({ length: count }, () =>
    Bun.spawn([process.execPath, '--eval', script], {
      env: {
        ...process.env,
        FACET_DIR: facetDir,
        OAUTH_STORE_MODULE: pathToFileURL(modulePath()).href,
        OAUTH_BINDING: JSON.stringify(binding),
        OAUTH_SENTINEL: sentinel,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  )

  const outcomes = await Promise.all(
    children.map(async (child) => ({
      exitCode: await child.exited,
      stdout: await new Response(child.stdout).text(),
      stderr: await new Response(child.stderr).text(),
    })),
  )
  expect(outcomes).toHaveLength(count)
  for (const outcome of outcomes) {
    expect(outcome.stderr).toBe('')
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toBe('ok')
  }
}

interface PipedSubprocess {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill(signal?: number | NodeJS.Signals): void
}

function spawnLockHolder(saveUncertain: boolean): PipedSubprocess {
  const script = `
    const store = await import(process.env.OAUTH_STORE_MODULE)
    const binding = JSON.parse(process.env.OAUTH_BINDING)
    const result = await store.withOAuthSessionLock(binding, async (lock) => {
      if (process.env.OAUTH_SAVE_UNCERTAIN === '1') {
        const current = await store.readOAuthSession(binding)
        if (!current.ok || current.value?.generation !== 1) throw new Error('missing ready state')
        const saved = await store.saveOAuthSession({
          ...current.value,
          generation: 2,
          status: 'uncertain',
          refresh_started_at: 1800000000000,
          refresh_attempts: 1,
        }, 1, lock)
        if (!saved.ok) throw new Error(saved.error.code)
      }
      process.stdout.write('held\\n')
      setInterval(() => {}, 1000)
      await new Promise(() => {})
      return { ok: true, value: 1 }
    })
    if (!result.ok) throw new Error(result.error.code)
  `
  return Bun.spawn([process.execPath, '--eval', script], {
    env: {
      ...process.env,
      FACET_DIR: facetDir,
      OAUTH_STORE_MODULE: pathToFileURL(modulePath()).href,
      OAUTH_BINDING: JSON.stringify(binding),
      OAUTH_SAVE_UNCERTAIN: saveUncertain ? '1' : '0',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

async function expectHolderReady(holder: PipedSubprocess): Promise<void> {
  const reader = holder.stdout.getReader()
  const chunk = await reader.read()
  reader.releaseLock()
  expect(chunk.done).toBe(false)
  expect(new TextDecoder().decode(chunk.value)).toBe('held\n')
}

class BusySqliteError extends Error {
  readonly code = 'SQLITE_BUSY'
  readonly errno = 5
}

describe('durable lifecycle regressions', () => {
  test('accepts a secure atomic replacement between lstat and descriptor open', async () => {
    await save(readySession(1), null)
    let replaced = false
    const result = await readOAuthSession(binding, {
      ...options,
      lstat: async (path) => {
        const before = await lstat(path)
        if (path === statePath() && !replaced) {
          replaced = true
          await save(readySession(2), 1)
        }
        return before
      },
    })
    expect(unwrap(result)).toEqual(readySession(2))
  })
})

describe('protected absence and opened descriptors', () => {
  test('tombstone retains revision and no tokens; stale null CAS cannot overwrite it', async () => {
    await save(readySession(1), null)
    unwrap(await withOAuthSessionLock(binding, (lock) => deleteOAuthSession(binding, 1, lock), options))
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    expect(raw).toEqual({ version: 2, ...binding, generation: 2, status: 'absent' })
    expect(unwrap(await readOAuthSession(binding, options))).toBeNull()
    const stale = await withOAuthSessionLock(binding, (lock) => saveOAuthSession(readySession(1), null, lock), options)
    if (stale.ok) expect.unreachable()
    expect(stale.error).toEqual({ code: 'GENERATION_CONFLICT', expected: null, actual: 2 })
    await save(readySession(3), 2)
    expect(unwrap(await readOAuthSession(binding, options))?.generation).toBe(3)
  })

  test.each([
    { version: 1 },
    { generation: -1 },
    { access_token: 'must-not-be-in-tombstone' },
    { client_id: 'x'.repeat(513) },
    { token_endpoint: 'http://unsafe.example' },
    { registry_origin: 'https://wrong.example' },
  ])('never treats malformed or wrong-origin tombstone as absence: %j', async (overrides) => {
    await save(readySession(1), null)
    writeFileSync(
      statePath(),
      JSON.stringify({ version: 2, ...binding, generation: 2, status: 'absent', ...overrides }),
    )
    const result = await readOAuthSession(binding, options)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('INVALID_SESSION')
  })

  test.each([
    'insecure-permissions',
    'multiple-links',
  ] as const)('validates %s on replacement descriptor rather than stale lstat', async (reason) => {
    await save(readySession(1), null)
    let replaced = false
    const result = await readOAuthSession(binding, {
      ...options,
      lstat: async (path) => {
        const before = await lstat(path)
        if (path === statePath() && !replaced) {
          replaced = true
          rmSync(path)
          writeFileSync(path, JSON.stringify(readySession(2)), {
            mode: reason === 'insecure-permissions' ? 0o644 : 0o600,
          })
          if (reason === 'multiple-links') linkSync(path, join(facetDir, 'second-link'))
        }
        return before
      },
    })
    expectUnsafe(result, reason)
  })

  test('refuses a symlink replacement after safe lstat without reading its token', async () => {
    await save(readySession(1), null)
    const outside = join(facetDir, 'outside-secret')
    writeFileSync(outside, JSON.stringify(readySession(2)), { mode: 0o600 })
    let replaced = false
    const result = await readOAuthSession(binding, {
      ...options,
      lstat: async (path) => {
        const before = await lstat(path)
        if (path === statePath() && !replaced) {
          replaced = true
          rmSync(path)
          symlinkSync(outside, path)
        }
        return before
      },
    })
    if (result.ok) expect.unreachable()
    expect(JSON.stringify(result)).not.toContain(readySession(2).access_token)
  })
})

describe('atomic replacement after descriptor open', () => {
  test('accepts a secure opened inode unlinked by atomic replacement before fstat', async () => {
    await save(readySession(1), null)
    const originalOpen = fsPromises.open
    let replaced = false
    let openedLinks: number | undefined
    const openProbe = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      if (args[0] === statePath() && !replaced) {
        replaced = true
        await save(readySession(2), 1)
        openedLinks = (await handle.stat()).nlink
      }
      return handle
    })
    try {
      expect(unwrap(await readOAuthSession(binding, options))).toEqual(readySession(1))
      expect(openedLinks).toBe(0)
      expect(unwrap(await readOAuthSession(binding, options))).toEqual(readySession(2))
    } finally {
      openProbe.mockRestore()
    }
  })

  test.each([2, 3])('rejects an opened descriptor given %i links after safe pathname inspection', async (links) => {
    await save(readySession(1), null)
    const originalOpen = fsPromises.open
    let linked = false
    let openedLinks: number | undefined
    const openProbe = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      if (args[0] === statePath() && !linked) {
        linked = true
        for (let index = 1; index < links; index++) linkSync(statePath(), join(facetDir, `hostile-link-${index}`))
        openedLinks = (await handle.stat()).nlink
      }
      return handle
    })
    try {
      expectUnsafe(await readOAuthSession(binding, options), 'multiple-links')
      expect(openedLinks).toBe(links)
    } finally {
      openProbe.mockRestore()
    }
  })

  for (const overrides of [
    { version: 2 },
    { access_token: '' },
    { registry_origin: 'https://other.example.test' },
    { client_id: 'other-client' },
    { issuer: 'https://other.example.test' },
    { authorization_endpoint: 'https://other.example.test/authorize' },
    { token_endpoint: 'https://other.example.test/token' },
    { verification_origin: 'https://other.example.test' },
  ]) {
    test(`rejects unlinked opened bytes with invalid schema/binding ${JSON.stringify(overrides)}`, async () => {
      await save(readySession(1), null)
      writeFileSync(statePath(), JSON.stringify({ ...readySession(1), ...overrides }))
      const originalOpen = fsPromises.open
      let unlinked = false
      let openedLinks: number | undefined
      const openProbe = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
        const handle = await originalOpen(...args)
        if (args[0] === statePath() && !unlinked) {
          unlinked = true
          rmSync(statePath())
          openedLinks = (await handle.stat()).nlink
        }
        return handle
      })
      try {
        const result = await readOAuthSession(binding, options)
        if (result.ok) expect.unreachable()
        expect(result.error.code).toBe('INVALID_SESSION')
        expect(openedLinks).toBe(0)
        expect(JSON.stringify(result)).not.toContain(readySession(1).access_token)
      } finally {
        openProbe.mockRestore()
      }
    })
  }
})

describe('unlinked descriptor retains metadata guards', () => {
  for (const reason of ['insecure-permissions', 'wrong-owner']) {
    test(`rejects ${reason} on an opened unlinked state descriptor`, async () => {
      await save(readySession(1), null)
      const originalOpen = fsPromises.open
      const restoreDescriptorStats: Array<() => void> = []
      let unlinked = false
      const openProbe = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
        const handle = await originalOpen(...args)
        if (args[0] === statePath() && !unlinked) {
          unlinked = true
          if (reason === 'insecure-permissions') chmodSync(statePath(), 0o644)
          rmSync(statePath())
          expect((await handle.stat()).nlink).toBe(0)
          if (reason === 'wrong-owner') {
            const originalStat = handle.stat.bind(handle)
            function wrongOwnerStat(opts?: StatOptions & { bigint?: false }): Promise<Stats>
            function wrongOwnerStat(opts: StatOptions & { bigint: true }): Promise<BigIntStats>
            function wrongOwnerStat(opts?: StatOptions): Promise<Stats | BigIntStats>
            async function wrongOwnerStat(opts?: StatOptions): Promise<Stats | BigIntStats> {
              const metadata = await originalStat(opts)
              if (typeof metadata.uid === 'bigint') metadata.uid += 1n
              else metadata.uid += 1
              return metadata
            }
            const descriptorStats = spyOn(handle, 'stat').mockImplementation(wrongOwnerStat)
            restoreDescriptorStats.push(() => descriptorStats.mockRestore())
          }
        }
        return handle
      })
      try {
        const result = await readOAuthSession(binding, options)
        expectUnsafe(result, reason === 'wrong-owner' ? 'wrong-owner' : 'insecure-permissions')
        expect(unlinked).toBe(true)
      } finally {
        for (const restore of restoreDescriptorStats) restore()
        openProbe.mockRestore()
      }
    })
  }
})

describe('directory authority', () => {
  test('creates each missing private component without changing an existing 0755 parent', async () => {
    chmodSync(facetDir, 0o755)
    const selected = join(facetDir, 'one', 'two', 'three')
    unwrap(
      await withOAuthSessionLock(binding, async () => ok(undefined), { ...options, resolveFacetDir: () => selected }),
    )
    expect(lstatSync(facetDir).mode & 0o777).toBe(0o755)
    for (const path of [join(facetDir, 'one'), join(facetDir, 'one', 'two'), selected, join(selected, 'oauth')]) {
      expect(lstatSync(path).mode & 0o777).toBe(0o700)
    }
  })

  test.each([false, true])('rejects real two-process rename authority (private child: %s)', async (nested) => {
    const authority = join(facetDir, 'authority')
    mkdirSync(authority, { mode: 0o777 })
    chmodSync(authority, 0o777)
    const selected = nested ? join(authority, 'private') : authority
    if (nested) mkdirSync(selected, { mode: 0o700 })
    const release = join(facetDir, 'release')
    const script = `
      const { withOAuthSessionLock } = await import(${JSON.stringify(modulePath())})
      const result = await withOAuthSessionLock(${JSON.stringify(binding)}, async () => {
        if (process.env.HOLDER === '1') {
          process.stdout.write('entered\\n')
          while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(5)
        }
        return {ok:true,value:'entered'}
      })
      process.stdout.write(JSON.stringify(result))
    `
    const first = Bun.spawn([process.execPath, '--eval', script], {
      env: { ...process.env, FACET_DIR: selected, HOLDER: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 5000,
    })
    try {
      const reader = first.stdout.getReader()
      const firstMessage = new TextDecoder().decode((await reader.read()).value)
      reader.releaseLock()
      renameSync(authority, `${authority}-displaced`)
      mkdirSync(authority, { mode: 0o777 })
      chmodSync(authority, 0o777)
      if (nested) mkdirSync(selected, { mode: 0o700 })
      const second = Bun.spawnSync([process.execPath, '--eval', script], {
        env: { ...process.env, FACET_DIR: selected, HOLDER: '0' },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 5000,
      })
      writeFileSync(release, '')
      expect(await first.exited).toBe(0)
      expect(second.exitCode).toBe(0)
      expect({ first: firstMessage, second: second.stdout.toString() }).toEqual({
        first: expect.stringContaining('insecure-permissions'),
        second: expect.stringContaining('insecure-permissions'),
      })
      expect(firstMessage).not.toContain('entered')
      expect(second.stdout.toString()).not.toContain('entered')
      expect(existsSync(join(selected, 'oauth'))).toBe(false)
    } finally {
      first.kill()
      await first.exited
    }
  })

  test('permits current-owned sticky ancestry and rejects simulated foreign-owned sticky/nonsticky authority', async () => {
    const selected = join(facetDir, 'child')
    expect(Bun.spawnSync(['/bin/chmod', '1777', facetDir]).exitCode).toBe(0)
    expect(lstatSync(facetDir).mode & 0o1777).toBe(0o1777)
    unwrap(await readOAuthSession(binding, { ...options, resolveFacetDir: () => selected }))
    for (const mode of [0o1777, 0o755]) {
      expect(Bun.spawnSync(['/bin/chmod', mode.toString(8), facetDir]).exitCode).toBe(0)
      expectUnsafe(
        await readOAuthSession(binding, {
          ...options,
          resolveFacetDir: () => selected,
          lstat: wrongOwnerLstat(facetDir),
        }),
        'wrong-owner',
      )
    }
  })

  test('rejects custom symlink ancestors and raced mkdir symlink winners without descent', async () => {
    const outside = join(facetDir, 'outside')
    mkdirSync(outside)
    const link = join(facetDir, 'redirect')
    symlinkSync(outside, link)
    expectUnsafe(await readOAuthSession(binding, { ...options, resolveFacetDir: () => join(link, 'child') }), 'symlink')
    const raced = join(facetDir, 'raced')
    const create = spyOn(fsPromises, 'mkdir').mockImplementation(async (path): Promise<never> => {
      if (path !== raced) throw new Error('unexpected creation')
      symlinkSync(outside, raced)
      throw Object.assign(new Error('race winner exists'), { code: 'EEXIST' })
    })
    try {
      expectUnsafe(
        await readOAuthSession(binding, { ...options, resolveFacetDir: () => join(raced, 'child') }),
        'symlink',
      )
      expect(readdirSync(outside)).toEqual([])
    } finally {
      create.mockRestore()
    }
  })

  test('checks actual opened authority and identity despite stale or simulated pathname metadata', async () => {
    const originalMode = lstatSync(facetDir).mode
    const altered = await readOAuthSession(binding, {
      ...options,
      lstat: async (path) => {
        const metadata = await lstat(path)
        if (path === facetDir) chmodSync(facetDir, 0o777)
        return metadata
      },
    })
    expectUnsafe(altered, 'insecure-permissions')
    chmodSync(facetDir, originalMode)
    const changedIdentity = await readOAuthSession(binding, {
      ...options,
      lstat: async (path) => {
        const metadata = await lstat(path)
        if (path === facetDir) metadata.ino += 1
        return metadata
      },
    })
    if (changedIdentity.ok) expect.unreachable('mismatched directory accepted')
    expect(changedIdentity.error.code).toBe('IO_ERROR')
    const selected = join(facetDir, 'child')
    const uid = process.getuid?.()
    if (uid === undefined) expect.unreachable()
    expectUnsafe(
      await readOAuthSession(binding, {
        ...options,
        ownerUid: uid + 1,
        resolveFacetDir: () => selected,
        lstat: async (path) => {
          const metadata = await lstat(path)
          if (metadata.uid === uid) metadata.uid = 0
          return metadata
        },
      }),
      'wrong-owner',
    )
  })

  test('freezes the absolute selection before an awaited cwd change', async () => {
    const previous = process.cwd()
    process.chdir(facetDir)
    let selected = 0
    try {
      unwrap(
        await readOAuthSession(binding, {
          ...options,
          resolveFacetDir: () => {
            selected++
            return 'relative/nested'
          },
          lstat: async (path) => {
            process.chdir(previous)
            return lstat(path)
          },
        }),
      )
      expect(selected).toBe(1)
      expect(existsSync(join(facetDir, 'relative/nested/oauth'))).toBe(true)
    } finally {
      process.chdir(previous)
    }
  })

  test.skipIf(process.platform !== 'darwin')(
    'accepts live root-owned tmp/var aliases and rejects a simulated spoofed alias target',
    async () => {
      const tmp = mkdtempSync('/tmp/oauth-alias-')
      try {
        unwrap(await readOAuthSession(binding, { ...options, resolveFacetDir: () => tmp }))
        unwrap(
          await readOAuthSession(binding, {
            ...options,
            resolveFacetDir: () => facetDir.replace(/^\/private\/var\//, '/var/'),
          }),
        )
        function spoof(path: fs.PathLike, encoding?: fs.EncodingOption): string
        function spoof(path: fs.PathLike, encoding: fs.BufferEncodingOption): Buffer<ArrayBuffer>
        function spoof(_path: fs.PathLike, encoding?: fs.EncodingOption | fs.BufferEncodingOption): string | Buffer {
          return encoding === 'buffer' || (typeof encoding === 'object' && encoding?.encoding === 'buffer')
            ? Buffer.from('private/spoof')
            : 'private/spoof'
        }
        const link = spyOn(fs, 'readlinkSync').mockImplementation(spoof)
        try {
          expectUnsafe(await readOAuthSession(binding, { ...options, resolveFacetDir: () => tmp }), 'symlink')
        } finally {
          link.mockRestore()
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    },
  )

  test.skipIf(process.platform !== 'darwin')(
    'checks real deny/allow/inherited ACL authority despite a linux option',
    async () => {
      const chmod = (...args: string[]) => {
        const child = Bun.spawnSync(['/bin/chmod', ...args], { stderr: 'pipe', timeout: 5000 })
        expect({ exit: child.exitCode, stderr: child.stderr.toString() }).toEqual({ exit: 0, stderr: '' })
      }
      try {
        chmod('+a', 'everyone deny delete', facetDir)
        unwrap(await readOAuthSession(binding, { ...options, platform: 'linux' }))
        chmod('-N', facetDir)
        chmod('+a', 'everyone allow delete,delete_child,directory_inherit', facetDir)
        const inherited = join(facetDir, 'inherited')
        mkdirSync(inherited)
        expectUnsafe(await readOAuthSession(binding, { ...options, platform: 'linux' }), 'insecure-permissions')
        chmod('-N', facetDir)
        expectUnsafe(
          await readOAuthSession(binding, { ...options, platform: 'linux', resolveFacetDir: () => inherited }),
          'insecure-permissions',
        )
      } finally {
        chmod('-RN', facetDir)
      }
    },
  )

  test.skipIf(process.platform !== 'darwin')(
    'maps unavailable native inspection in an isolated process with constant cause',
    async () => {
      const nativePath = fileURLToPath(new URL('../oauth-permissions.ts', import.meta.url))
      const script = `
      import { mock } from 'bun:test'
      import { fstatSync } from 'node:fs'
      mock.module(${JSON.stringify(nativePath)}, () => ({ inspectDarwinDirectoryAcl(fd) {
        if (!fstatSync(fd).isDirectory()) throw Error('not a borrowed directory')
        return {ok:false,reason:'acl-unavailable'}
      }}))
      const {readOAuthSession} = await import(${JSON.stringify(modulePath())})
      console.log(JSON.stringify(await readOAuthSession(${JSON.stringify(binding)}, {platform:'linux'})))
    `
      const child = Bun.spawnSync([process.execPath, '--eval', script], {
        env: { ...process.env, FACET_DIR: facetDir },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 5000,
      })
      expect(child.exitCode).toBe(0)
      expect(JSON.parse(child.stdout.toString())).toEqual({
        ok: false,
        error: {
          code: 'IO_ERROR',
          operation: 'inspect permissions',
          path: '/',
          cause: 'Directory permissions could not be verified.',
        },
      })
      expect(readdirSync(facetDir)).toEqual([])
    },
  )
})

describe('acquisition cancellation', () => {
  test('pre-abort performs no resolution, filesystem work or callback', async () => {
    const controller = new AbortController()
    controller.abort()
    let touched = 0
    const result = await withOAuthSessionLock(
      binding,
      async () => {
        touched++
        return ok(undefined)
      },
      {
        ...options,
        signal: controller.signal,
        resolveFacetDir: () => {
          touched++
          return facetDir
        },
      },
    )
    expect(result).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    expect(touched).toBe(0)
    expect(readdirSync(facetDir)).toEqual([])
  })

  test('cancels a real held SQLite contender promptly, cleans listeners, and never acquires late', async () => {
    const holder = spawnLockHolder(false)
    const controller = new AbortController()
    let callbacks = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await expectHolderReady(holder)
      const started = performance.now()
      timer = setTimeout(() => controller.abort(), 40)
      const result = await withOAuthSessionLock(
        binding,
        async () => {
          callbacks++
          return ok(undefined)
        },
        {
          ...options,
          signal: controller.signal,
          lockTimeoutMs: 5000,
          lockPollMs: 2000,
        },
      )
      expect(result).toEqual({ ok: false, error: { code: 'CANCELLED' } })
      expect(performance.now() - started).toBeLessThan(1000)
      expect(callbacks).toBe(0)
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    } finally {
      clearTimeout(timer)
      holder.kill('SIGKILL')
      await holder.exited
    }
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
    expect(callbacks).toBe(0)
  })

  test('cancels startup busy waiting and closes the opened database', async () => {
    const controller = new AbortController()
    let closes = 0
    const originalClose = Database.prototype.close
    const close = spyOn(Database.prototype, 'close').mockImplementation(function (this: Database, ...args) {
      closes++
      return originalClose.apply(this, args)
    })
    const query = spyOn(Database.prototype, 'query').mockImplementation((): never => {
      throw new BusySqliteError()
    })
    const timer = setTimeout(() => controller.abort(), 30)
    let callbacks = 0
    try {
      const started = performance.now()
      const result = await withOAuthSessionLock(
        binding,
        async () => {
          callbacks++
          return ok(undefined)
        },
        {
          ...options,
          signal: controller.signal,
          lockPollMs: 2000,
        },
      )
      expect(result).toEqual({ ok: false, error: { code: 'CANCELLED' } })
      expect(performance.now() - started).toBeLessThan(1000)
      expect(callbacks).toBe(0)
      expect(closes).toBeGreaterThan(0)
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    } finally {
      clearTimeout(timer)
      query.mockRestore()
      close.mockRestore()
    }
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
  })

  test('abort after BEGIN but before callback rolls back, closes and never invokes callback', async () => {
    const controller = new AbortController()
    const original = Database.prototype.exec
    let rolledBack = false
    let callbacks = 0
    const exec = spyOn(Database.prototype, 'exec').mockImplementation(function (this: Database, sql) {
      const result = original.call(this, sql)
      if (sql === 'BEGIN IMMEDIATE') queueMicrotask(() => controller.abort())
      if (sql === 'ROLLBACK') rolledBack = true
      return result
    })
    try {
      expect(
        await withOAuthSessionLock(
          binding,
          async () => {
            callbacks++
            return ok(undefined)
          },
          {
            ...options,
            signal: controller.signal,
          },
        ),
      ).toEqual({ ok: false, error: { code: 'CANCELLED' } })
      expect(callbacks).toBe(0)
      expect(rolledBack).toBe(true)
    } finally {
      exec.mockRestore()
    }
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
  })

  test('abort wins simultaneous timeout, while an un-aborted wait retains LOCK_TIMEOUT', async () => {
    const controller = new AbortController()
    const original = Database.prototype.exec
    const exec = spyOn(Database.prototype, 'exec').mockImplementation(function (this: Database, sql) {
      if (sql === 'BEGIN IMMEDIATE') {
        controller.abort()
        throw new BusySqliteError()
      }
      return original.call(this, sql)
    })
    try {
      expect(
        await withOAuthSessionLock(binding, async () => ok(undefined), {
          ...options,
          signal: controller.signal,
          lockTimeoutMs: 0,
        }),
      ).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    } finally {
      exec.mockRestore()
    }
    unwrap(
      await withOAuthSessionLock(
        binding,
        async () => {
          const timeout = await withOAuthSessionLock(binding, async () => ok(undefined), {
            ...options,
            lockTimeoutMs: 10,
          })
          if (timeout.ok) expect.unreachable()
          expect(timeout.error.code).toBe('LOCK_TIMEOUT')
          return ok(undefined)
        },
        options,
      ),
    )
  })

  test('an entered callback drains its save and busy COMMIT after abort', async () => {
    const controller = new AbortController()
    const original = Database.prototype.exec
    let commits = 0
    const exec = spyOn(Database.prototype, 'exec').mockImplementation(function (this: Database, sql) {
      if (sql === 'COMMIT' && commits++ === 0) throw new BusySqliteError()
      return original.call(this, sql)
    })
    try {
      const result = await withOAuthSessionLock(
        binding,
        async (lock) => {
          controller.abort()
          await Bun.sleep(10)
          return saveOAuthSession(readySession(1), null, lock)
        },
        { ...options, signal: controller.signal },
      )
      unwrap(result)
      expect(commits).toBe(2)
      expect(unwrap(await readOAuthSession(binding, options))).toEqual(readySession(1))
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    } finally {
      exec.mockRestore()
    }
  })
})

describe('acquisition directory cleanup', () => {
  test('abort after directory open closes every borrowed handle and prevents descent', async () => {
    const controller = new AbortController()
    const original = fsPromises.open
    const handles: fsPromises.FileHandle[] = []
    const opened = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args)
      handles.push(handle)
      if (args[0] === facetDir) controller.abort()
      return handle
    })
    let callbacks = 0
    try {
      expect(
        await withOAuthSessionLock(
          binding,
          async () => {
            callbacks++
            return ok(undefined)
          },
          {
            ...options,
            signal: controller.signal,
          },
        ),
      ).toEqual({ ok: false, error: { code: 'CANCELLED' } })
      expect(handles.length).toBeGreaterThan(0)
      for (const handle of handles) expect(handle.fd).toBe(-1)
      expect(callbacks).toBe(0)
      expect(readdirSync(facetDir)).toEqual([])
    } finally {
      opened.mockRestore()
    }
  })

  test('abort after creating a missing component stops before creating oauth state', async () => {
    const controller = new AbortController()
    const selected = join(facetDir, 'new-parent')
    let callbacks = 0
    const result = await withOAuthSessionLock(
      binding,
      async () => {
        callbacks++
        return ok(undefined)
      },
      {
        ...options,
        signal: controller.signal,
        resolveFacetDir: () => selected,
        lstat: async (path) => {
          const metadata = await lstat(path)
          if (path === selected) controller.abort()
          return metadata
        },
      },
    )
    expect(result).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    expect(lstatSync(selected).mode & 0o777).toBe(0o700)
    expect(readdirSync(selected)).toEqual([])
    expect(callbacks).toBe(0)
  })

  test('aborting an entered throwing callback still rolls back and releases its lock', async () => {
    const controller = new AbortController()
    await expect(
      withOAuthSessionLock(
        binding,
        async () => {
          controller.abort()
          await Bun.sleep(5)
          throw new Error('callback failure')
        },
        { ...options, signal: controller.signal },
      ),
    ).rejects.toThrow('callback failure')
    unwrap(await withOAuthSessionLock(binding, async () => ok(undefined), options))
  })
})
