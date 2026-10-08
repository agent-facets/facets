import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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
    expect(mismatch.ok).toBe(false)
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
      expect(rejectedDelete.ok).toBe(false)
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
      expect(result.ok).toBe(false)
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
    expect(reset.ok).toBe(false)
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
      expect(result.ok).toBe(false)
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
    expect(stale.ok).toBe(false)
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
        expect(contender.ok).toBe(false)
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

  test('runs the SQLite-backed store from a compiled Bun executable', async () => {
    const script = join(facetDir, 'compiled-smoke.ts')
    const executable = join(facetDir, 'compiled-smoke')
    writeFileSync(
      script,
      `
        import { withOAuthSessionLock } from ${JSON.stringify(modulePath())}
        const binding = JSON.parse(process.env.OAUTH_BINDING ?? '')
        const result = await withOAuthSessionLock(binding, async () => ({ ok: true, value: 'compiled-ok' }))
        if (!result.ok) throw new Error(result.error.code)
        process.stdout.write(result.value)
      `,
    )
    const built = Bun.spawn([process.execPath, 'build', '--compile', script, '--outfile', executable], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const buildOutput = await collect(built)
    if (buildOutput.exitCode !== 0) throw new Error(`compiled smoke build failed: ${buildOutput.stderr}`)

    const smoke = Bun.spawn([executable], {
      env: { ...process.env, FACET_DIR: facetDir, OAUTH_BINDING: JSON.stringify(binding) },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const smokeOutput = await collect(smoke)
    expect(smokeOutput.exitCode).toBe(0)
    expect(smokeOutput.stderr).toBe('')
    expect(smokeOutput.stdout).toBe('compiled-ok')
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
  expect(result.ok).toBe(false)
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
  expect(result.ok).toBe(false)
  if (result.ok) expect.unreachable('unsafe state unexpectedly loaded')
  expect(result.error.code).toBe('UNSAFE_STATE')
  if (result.error.code !== 'UNSAFE_STATE') expect.unreachable('unexpected failure code')
  expect(result.error.reason).toBe(reason)
}

function expectBindingMismatch(result: OAuthStoreResult<unknown>, field: keyof OAuthSessionBinding): void {
  expect(result.ok).toBe(false)
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

async function collect(process: PipedSubprocess): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

class BusySqliteError extends Error {
  readonly code = 'SQLITE_BUSY'
  readonly errno = 5
}
