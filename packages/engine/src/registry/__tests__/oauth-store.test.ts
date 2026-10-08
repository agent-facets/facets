import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
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
    const unsupported: OAuthStoreOptions = {
      platform: 'win32',
      resolveFacetDir: () => {
        resolutions += 1
        return join(facetDir, 'must-not-be-used')
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

  test('does not release a lock whose owner nonce was replaced', async () => {
    const lockPath = join(
      facetDir,
      'oauth',
      `${createHash('sha256').update(binding.registry_origin).digest('hex')}.lock`,
    )
    const result = await withOAuthSessionLock(
      binding,
      async () => {
        writeFileSync(join(lockPath, 'owner.json'), '{"nonce":"replacement"}\n', { mode: 0o600 })
        return ok(undefined)
      },
      options,
    )
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable('replaced lock nonce unexpectedly released')
    expect(result.error.code).toBe('LOCK_LOST')
    expect(existsSync(lockPath)).toBe(true)
  })

  test('permits exactly one holder across N=2 real processes', async () => {
    await runLockRace(2)
  })

  test('permits exactly one holder across 10N=20 real processes', async () => {
    await runLockRace(20)
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

async function runLockRace(count: number): Promise<void> {
  const modulePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'oauth-store.ts')
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
        OAUTH_STORE_MODULE: pathToFileURL(modulePath).href,
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
