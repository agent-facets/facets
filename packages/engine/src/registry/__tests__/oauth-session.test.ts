import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCredentialsToken } from '../credentials.ts'
import {
  beginCliLogin,
  completeCliLogin,
  logoutCliSession,
  type RegistrySessionOptions,
  resolveRegistryCredential,
} from '../oauth-session.ts'
import * as oauthStore from '../oauth-store.ts'
import {
  deleteOAuthSession,
  type OAuthSession,
  type OAuthSessionBinding,
  type ReadyOAuthSession,
  readOAuthSession,
  saveOAuthSession,
  withOAuthSessionLock,
} from '../oauth-store.ts'
import type { WireAuthMeResponse } from '../wire.ts'

const REGISTRY = 'https://registry.example'
const OTHER_REGISTRY = 'https://other-registry.example'
const CLIENT_ID = 'client_01HZXYPJYQ8V7Z9M4G3K2N1P0R'
const ISSUER = `https://api.workos.com/user_management/${CLIENT_ID}`
const AUTHORIZATION_ENDPOINT = 'https://api.workos.com/user_management/authorize/device'
const TOKEN_ENDPOINT = 'https://api.workos.com/user_management/authenticate'
const VERIFICATION = 'https://login.example'
const ONBOARDING = 'https://app.example/auth/onboarding'
const NOW = 2_000_000_000_000
const CANARY = 'secret-canary-must-not-escape'
const REFRESH = 'old-refresh-secret'
const ROTATED = 'rotated-refresh-secret'
const DEVICE = 'device-code-secret'

let facetDir: string
let originalFacetDir: string | undefined
let originalToken: string | undefined
let originalRegistry: string | undefined

beforeEach(() => {
  originalFacetDir = process.env.FACET_DIR
  originalToken = process.env.FACET_TOKEN
  originalRegistry = process.env.FACET_REGISTRY_URL
  facetDir = join(tmpdir(), `facet-oauth-session-${randomUUID()}`)
  process.env.FACET_DIR = facetDir
  delete process.env.FACET_TOKEN
  process.env.FACET_REGISTRY_URL = REGISTRY
})

afterEach(() => {
  rmSync(facetDir, { recursive: true, force: true })
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  if (originalToken === undefined) delete process.env.FACET_TOKEN
  else process.env.FACET_TOKEN = originalToken
  if (originalRegistry === undefined) delete process.env.FACET_REGISTRY_URL
  else process.env.FACET_REGISTRY_URL = originalRegistry
})

function binding(registryOrigin = REGISTRY, clientId = CLIENT_ID): OAuthSessionBinding {
  return {
    registry_origin: registryOrigin,
    client_id: clientId,
    issuer: `https://api.workos.com/user_management/${clientId}`,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    verification_origin: VERIFICATION,
  }
}

function statePath(registryOrigin = REGISTRY): string {
  const hash = createHash('sha256').update(registryOrigin).digest('hex')
  return join(facetDir, 'oauth', `${hash}.json`)
}

function configResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    provider: 'workos',
    client_id: CLIENT_ID,
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    verification_origin: VERIFICATION,
    onboarding_url: ONBOARDING,
    ...overrides,
  }
}

function profile(userUuid = 'registry-user-uuid'): WireAuthMeResponse {
  return {
    user_uuid: userUuid,
    username: 'example',
    email: 'example@example.test',
    tier: 'free',
    suspended: false,
    startup_experience: { kind: 'landing-only' },
    getting_started: { kind: 'unavailable' },
  }
}

function accessToken(overrides: Record<string, unknown> = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    exp: Math.floor(NOW / 1_000) + 3_600,
    iss: ISSUER,
    client_id: CLIENT_ID,
    sub: 'workos-user',
    sid: 'workos-session',
    auth_time: Math.floor(NOW / 1_000) - 10,
    ...overrides,
  })}.signature`
}

function ready(overrides: Partial<ReadyOAuthSession> = {}): ReadyOAuthSession {
  return {
    version: 1,
    ...binding(),
    access_token: accessToken(),
    refresh_token: REFRESH,
    expires_at: NOW + 3_600_000,
    subject: 'workos-user',
    session_id: 'workos-session',
    user_uuid: 'registry-user-uuid',
    generation: 1,
    status: 'ready',
    ...overrides,
  }
}

function tokenResponse(access = accessToken(), refresh = ROTATED): Record<string, unknown> {
  return { access_token: access, refresh_token: refresh }
}

function deviceResponse(): Record<string, unknown> {
  return {
    device_code: DEVICE,
    user_code: 'ABCD-EFGH',
    verification_uri: `${VERIFICATION}/device`,
    verification_uri_complete: `${VERIFICATION}/device?user_code=ABCD-EFGH`,
    expires_in: 300,
    interval: 5,
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function makeFetch(handler: (request: Request, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  const fetcher = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init)
    return handler(request, init)
  }
  fetcher.preconnect = globalThis.fetch.preconnect
  return fetcher
}

function options(fetcher: typeof fetch, overrides: Partial<RegistrySessionOptions> = {}): RegistrySessionOptions {
  return { registryUrl: REGISTRY, fetch: fetcher, now: () => NOW, sleep: async () => {}, ...overrides }
}

async function seed(session: OAuthSession = ready()): Promise<void> {
  const result = await withOAuthSessionLock(binding(), (lock) => saveOAuthSession(session, null, lock))
  expect(result.ok).toBe(true)
}

async function stored(): Promise<OAuthSession | null> {
  const result = await readOAuthSession(binding())
  expect(result.ok).toBe(true)
  if (!result.ok) expect.unreachable()
  return result.value
}

describe('registry credential precedence and absence', () => {
  test('fresh FACET_DIR under the real sticky temp parent stays absent without network or OAuth directory creation', async () => {
    let calls = 0
    const result = await resolveRegistryCredential(
      options(
        makeFetch(() => {
          calls++
          return json(configResponse())
        }),
      ),
    )
    expect(result).toEqual({ ok: true, value: { source: 'absent' } })
    expect(calls).toBe(0)
    expect(await Bun.file(statePath()).exists()).toBe(false)
    expect(await Bun.file(join(facetDir, 'oauth')).exists()).toBe(false)
  })

  test('ENV and saved PAT win without OAuth fetch even when OAuth state exists', async () => {
    await seed()
    writeCredentialsToken('saved-pat')
    let calls = 0
    const fetcher = makeFetch(() => {
      calls++
      return json(configResponse())
    })
    process.env.FACET_TOKEN = ' env-pat '
    expect(await resolveRegistryCredential(options(fetcher))).toEqual({
      ok: true,
      value: { source: 'env', token: 'env-pat' },
    })
    delete process.env.FACET_TOKEN
    expect(await resolveRegistryCredential(options(fetcher))).toEqual({
      ok: true,
      value: { source: 'file', token: 'saved-pat' },
    })
    expect(calls).toBe(0)
  })

  test('unreadable PAT is explicit failure and never selects OAuth', async () => {
    mkdirSync(facetDir, { mode: 0o700 })
    mkdirSync(join(facetDir, 'credentials'), { mode: 0o700 })
    let calls = 0
    const result = await resolveRegistryCredential(
      options(
        makeFetch(() => {
          calls++
          return json(configResponse())
        }),
      ),
    )
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('PAT_UNREADABLE')
    expect(calls).toBe(0)
  })

  test('unsupported platform preserves anonymous resolution and rejects native OAuth actions before I/O', async () => {
    let calls = 0
    const unsupported = options(
      makeFetch(() => {
        calls++
        return json(configResponse())
      }),
      { platform: 'win32' },
    )
    expect(await resolveRegistryCredential(unsupported)).toEqual({ ok: true, value: { source: 'absent' } })
    const begin = await beginCliLogin(unsupported)
    if (begin.ok) expect.unreachable()
    expect(begin.error.code).toBe('UNSUPPORTED_PLATFORM')
    const logout = await logoutCliSession(unsupported)
    if (logout.ok) expect.unreachable()
    expect(logout.error.code).toBe('UNSUPPORTED_PLATFORM')
    expect(calls).toBe(0)
    expect(await Bun.file(join(facetDir, 'oauth')).exists()).toBe(false)
  })

  test('dangling symlink and wrong-kind OAuth candidate fail before configuration network', async () => {
    mkdirSync(join(facetDir, 'oauth'), { recursive: true, mode: 0o700 })
    symlinkSync(join(facetDir, 'missing'), statePath())
    let calls = 0
    const fetcher = makeFetch(() => {
      calls++
      return json(configResponse())
    })
    const linked = await resolveRegistryCredential(options(fetcher))
    expect(linked).toEqual({ ok: false, error: { code: 'STATE_UNAVAILABLE', reason: 'UNSAFE_STATE' } })
    rmSync(statePath())
    mkdirSync(statePath())
    const wrongKind = await resolveRegistryCredential(options(fetcher))
    expect(wrongKind).toEqual(linked)
    expect(calls).toBe(0)
  })

  test('an inaccessible OAuth path fails closed before configuration network', async () => {
    mkdirSync(facetDir, { mode: 0o700 })
    writeFileSync(join(facetDir, 'oauth'), 'not-a-directory')
    let calls = 0
    const result = await resolveRegistryCredential(
      options(
        makeFetch(() => {
          calls++
          return json(configResponse())
        }),
      ),
    )
    expect(result).toEqual({ ok: false, error: { code: 'STATE_UNAVAILABLE', reason: 'IO_ERROR' } })
    expect(calls).toBe(0)
  })
})

describe('browser login and binding', () => {
  test('fresh first login verifies /auth/me and persists a ready session before exposing profile', async () => {
    const seen: string[] = []
    let profileRequest: Request | undefined
    let profileInit: RequestInit | undefined
    let clock = NOW
    const fetcher = makeFetch(async (request, init) => {
      seen.push(`${request.method} ${request.url}`)
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      if (request.url.endsWith('/v0/auth/me')) {
        profileRequest = request
        profileInit = init
        return json(profile())
      }
      return json({}, 404)
    })
    const setup = options(fetcher, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    const begun = await beginCliLogin(setup)
    if (!begun.ok) expect.unreachable()
    expect(begun.value.display.userCode).toBe('ABCD-EFGH')
    expect(JSON.stringify(begun.value)).not.toContain(DEVICE)
    expect(await stored()).toBeNull()
    const completed = await completeCliLogin(begun.value, setup)
    expect(completed).toEqual({ ok: true, value: profile() })
    if (!completed.ok) expect.unreachable()
    expect(profileRequest?.headers.get('authorization')).toBe(`Bearer ${accessToken()}`)
    expect(profileRequest?.headers.get('cookie')).toBeNull()
    expect(profileInit?.credentials).toBe('omit')
    expect(profileInit?.redirect).toBe('error')
    expect(completed.value.user_uuid).toBe('registry-user-uuid')
    const saved = await stored()
    expect(saved?.status).toBe('ready')
    expect(saved?.user_uuid).toBe('registry-user-uuid')
    expect(saved?.refresh_token).toBe(ROTATED)
    expect(seen.at(-1)).toBe(`GET ${REGISTRY}/v0/auth/me`)
  })

  test('onboarding and malformed profile never overwrite existing state', async () => {
    await seed()
    const oldBytes = readFileSync(statePath(), 'utf8')
    for (const response of [
      json({ code: 'E_ONBOARDING_REQUIRED', error: CANARY, fix: CANARY, docs_url: CANARY }, 403),
      json({ user_uuid: '', username: 'x' }),
    ]) {
      const fetcher = makeFetch(async (request) => {
        if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
        if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
        if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
        return json(await response.json(), response.status)
      })
      const begun = await beginCliLogin(options(fetcher))
      expect(begun.ok).toBe(true)
      if (!begun.ok) expect.unreachable()
      const completed = await completeCliLogin(begun.value, options(fetcher))
      expect(completed.ok).toBe(false)
      if (completed.ok) expect.unreachable()
      if (response.status === 403) {
        expect(completed.error).toEqual({ code: 'ONBOARDING_REQUIRED', onboardingUrl: ONBOARDING })
      } else {
        expect(completed.error.code).toBe('REGISTRY_VERIFICATION_FAILED')
      }
      expect(JSON.stringify(completed)).not.toContain(CANARY)
      expect(readFileSync(statePath(), 'utf8')).toBe(oldBytes)
    }
  })

  test('a stale login attempt loses generation CAS after a replacement', async () => {
    await seed()
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      return json(profile())
    })
    const begun = await beginCliLogin(options(fetcher))
    if (!begun.ok) expect.unreachable()
    const replaced = await withOAuthSessionLock(binding(), (lock) =>
      saveOAuthSession(ready({ generation: 2 }), 1, lock),
    )
    expect(replaced.ok).toBe(true)
    const completed = await completeCliLogin(begun.value, options(fetcher))
    expect(completed).toEqual({ ok: false, error: { code: 'SESSION_CHANGED' } })
    expect((await stored())?.generation).toBe(2)
  })

  test('pending browser login cannot overwrite a deleted and recreated session', async () => {
    await seed()
    let profileCalls = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      profileCalls++
      return json(profile('replacement-user'))
    })
    const oldAttempt = await beginCliLogin(options(fetcher))
    if (!oldAttempt.ok) expect.unreachable()

    const removed = await withOAuthSessionLock(binding(), (lock) => deleteOAuthSession(binding(), 1, lock))
    expect(removed).toEqual({ ok: true, value: true })
    const newAttempt = await beginCliLogin(options(fetcher))
    if (!newAttempt.ok) expect.unreachable()
    const newCompletion = await completeCliLogin(newAttempt.value, options(fetcher))
    expect(newCompletion.ok).toBe(true)
    expect((await stored())?.generation).toBe(3)
    expect((await stored())?.user_uuid).toBe('replacement-user')

    const staleCompletion = await completeCliLogin(oldAttempt.value, options(fetcher))
    expect(staleCompletion).toEqual({ ok: false, error: { code: 'SESSION_CHANGED' } })
    expect((await stored())?.generation).toBe(3)
    expect((await stored())?.user_uuid).toBe('replacement-user')
    expect(profileCalls).toBe(1)
  })

  test('cancelled replacement keeps the previous session bytes', async () => {
    await seed()
    const original = readFileSync(statePath(), 'utf8')
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      return json(tokenResponse())
    })
    const begun = await beginCliLogin(options(fetcher))
    if (!begun.ok) expect.unreachable()
    const controller = new AbortController()
    controller.abort()
    const completed = await completeCliLogin(begun.value, options(fetcher, { signal: controller.signal }))
    expect(completed).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    expect(readFileSync(statePath(), 'utf8')).toBe(original)
  })
})

describe('refresh fencing and bound identity', () => {
  test('ready access resolves with its frozen origin and verified registry profile', async () => {
    await seed()
    let calls = 0
    const fetcher = makeFetch((request, init) => {
      calls++
      if (request.url.endsWith('/v0/auth/cli/config')) {
        process.env.FACET_REGISTRY_URL = OTHER_REGISTRY
        return json(configResponse())
      }
      expect(request.url).toBe(`${REGISTRY}/v0/auth/me`)
      expect(request.headers.get('authorization')).toBe(`Bearer ${accessToken()}`)
      expect(init?.credentials).toBe('omit')
      return json(profile())
    })
    const result = await resolveRegistryCredential(options(fetcher))
    expect(result).toEqual({
      ok: true,
      value: { source: 'oauth', token: accessToken(), registryOrigin: REGISTRY, profile: profile() },
    })
    expect(calls).toBe(2)
  })

  test('changed client binding fails closed before refresh or verification', async () => {
    await seed()
    let calls = 0
    const fetcher = makeFetch((request) => {
      calls++
      if (request.url.endsWith('/v0/auth/cli/config')) {
        return json(
          configResponse({ client_id: 'client_other', issuer: 'https://api.workos.com/user_management/client_other' }),
        )
      }
      return json(tokenResponse())
    })
    const result = await resolveRegistryCredential(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'STATE_UNAVAILABLE', reason: 'INVALID_SESSION' } })
    expect(calls).toBe(1)
    expect((await stored())?.status).toBe('ready')
  })

  test('other registry selection cannot discover the selected origin session', async () => {
    await seed()
    let calls = 0
    const result = await resolveRegistryCredential(
      options(
        makeFetch(() => {
          calls++
          return json(configResponse())
        }),
        {
          registryUrl: OTHER_REGISTRY,
        },
      ),
    )
    expect(result).toEqual({ ok: true, value: { source: 'absent' } })
    expect(calls).toBe(0)
    expect((await stored())?.status).toBe('ready')
  })

  test('forged issuer config fails before store refresh or bearer verification', async () => {
    await seed()
    let calls = 0
    const fetcher = makeFetch(() => {
      calls++
      return json(configResponse({ issuer: 'https://evil.example' }))
    })
    const result = await resolveRegistryCredential(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'CONFIG_UNAVAILABLE', reason: 'INVALID_CLI_CONFIG' } })
    expect(calls).toBe(1)
    expect((await stored())?.status).toBe('ready')
  })

  test('a lost first response retries the exact refresh token and converges on one rotated pair', async () => {
    await seed(ready({ expires_at: NOW + 20_000 }))
    const sent: string[] = []
    let calls = 0
    const fetcher = makeFetch(async (request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        calls++
        const form = new URLSearchParams(await request.text())
        sent.push(form.get('refresh_token') ?? '')
        if (calls === 1) throw new Error(CANARY)
        return json(tokenResponse())
      }
      return json(profile())
    })
    const result = await resolveRegistryCredential(options(fetcher))
    if (!result.ok) expect.unreachable()
    expect(result.value.source).toBe('oauth')
    expect(sent).toEqual([REFRESH, REFRESH])
    const saved = await stored()
    expect(saved?.status).toBe('ready')
    expect(saved?.refresh_token).toBe(ROTATED)
    expect(saved?.generation).toBe(5)
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('transient refresh exhaustion retains unexpired old access and durable uncertain fence', async () => {
    await seed(ready({ expires_at: NOW + 20_000 }))
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        exchanges++
        return json({ error: CANARY }, 503)
      }
      return json(profile())
    })
    const result = await resolveRegistryCredential(options(fetcher))
    if (!result.ok) expect.unreachable()
    expect(result.value.source).toBe('oauth')
    if (result.value.source !== 'oauth') expect.unreachable()
    expect(result.value.token).toBe(accessToken())
    expect(exchanges).toBe(3)
    const saved = await stored()
    expect(saved?.status).toBe('uncertain')
    if (saved?.status !== 'uncertain') expect.unreachable()
    expect(saved.refresh_attempts).toBe(3)
    expect(saved.refresh_started_at).toBe(NOW)
    expect(saved.refresh_token).toBe(REFRESH)
  })

  test('expired old access cannot become an anonymous or alternate-identity fallback', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        exchanges++
        return json({ error: CANARY }, 503)
      }
      return json(profile())
    })
    const result = await resolveRegistryCredential(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'REFRESH_UNAVAILABLE', reason: 'transient' } })
    expect(exchanges).toBe(3)
    expect((await stored())?.status).toBe('uncertain')
  })

  test('stale or exhausted persisted replay budget never sends another refresh', async () => {
    const cases: ReadonlyArray<readonly [number, 1 | 3]> = [
      [NOW - 25_000, 1],
      [NOW, 3],
    ]
    const steps: ReadonlyArray<1 | 2 | 3> = [1, 2, 3]
    for (const [started, attempts] of cases) {
      await seed()
      const fenced = await withOAuthSessionLock(binding(), async (lock) => {
        for (const step of steps) {
          if (step > attempts) break
          const saved = await saveOAuthSession(
            {
              ...ready({ generation: step + 1 }),
              status: 'uncertain',
              refresh_started_at: started,
              refresh_attempts: step,
            },
            step,
            lock,
          )
          if (!saved.ok) return saved
        }
        return { ok: true, value: undefined }
      })
      expect(fenced.ok).toBe(true)
      let exchanges = 0
      const fetcher = makeFetch((request) => {
        if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
        exchanges++
        return json(tokenResponse())
      })
      const result = await resolveRegistryCredential(options(fetcher))
      expect(result).toEqual({ ok: false, error: { code: 'REFRESH_UNAVAILABLE', reason: 'stale-window' } })
      expect(exchanges).toBe(0)
      rmSync(facetDir, { recursive: true, force: true })
    }
  })

  test('a future persisted first-dispatch timestamp cannot extend the replay window', async () => {
    await seed()
    const fenced = await withOAuthSessionLock(binding(), (lock) =>
      saveOAuthSession(
        { ...ready({ generation: 2 }), status: 'uncertain', refresh_started_at: NOW + 1, refresh_attempts: 1 },
        1,
        lock,
      ),
    )
    expect(fenced.ok).toBe(true)
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      exchanges++
      return json(tokenResponse())
    })
    expect(await resolveRegistryCredential(options(fetcher))).toEqual({
      ok: false,
      error: { code: 'REFRESH_UNAVAILABLE', reason: 'stale-window' },
    })
    expect(exchanges).toBe(0)
  })

  test('a first request crossing the 25-second deadline never makes a second exchange', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let clock = NOW
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      exchanges++
      clock += 25_000
      return json({ error: CANARY }, 503)
    })
    const result = await resolveRegistryCredential(options(fetcher, { now: () => clock }))
    expect(result).toEqual({ ok: false, error: { code: 'REFRESH_UNAVAILABLE', reason: 'transient' } })
    expect(exchanges).toBe(1)
    const saved = await stored()
    expect(saved?.status).toBe('uncertain')
    if (saved?.status !== 'uncertain') expect.unreachable()
    expect(saved.refresh_attempts).toBe(1)
  })

  test('a resumed uncertain exchange preserves first-dispatch time and increments the attempt durably', async () => {
    await seed()
    const fenced = await withOAuthSessionLock(binding(), (lock) =>
      saveOAuthSession(
        { ...ready({ generation: 2 }), status: 'uncertain', refresh_started_at: NOW - 1_000, refresh_attempts: 1 },
        1,
        lock,
      ),
    )
    expect(fenced.ok).toBe(true)
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        exchanges++
        return json({ error: CANARY }, 503)
      }
      return json(profile())
    })
    const result = await resolveRegistryCredential(options(fetcher))
    expect(result.ok).toBe(true)
    expect(exchanges).toBe(2)
    const saved = await stored()
    expect(saved?.status).toBe('uncertain')
    if (saved?.status !== 'uncertain') expect.unreachable()
    expect(saved.refresh_started_at).toBe(NOW - 1_000)
    expect(saved.refresh_attempts).toBe(3)
  })

  test('rotated identity mismatch retains quarantined pair', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      return json(profile('different-registry-user'))
    })
    const result = await resolveRegistryCredential(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'IDENTITY_MISMATCH' } })
    const saved = await stored()
    expect(saved?.status).toBe('verification-pending')
    expect(saved?.refresh_token).toBe(ROTATED)
  })

  test('only HTTP 400 invalid_grant marks reauthentication required', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      return json({ error: 'invalid_grant', error_description: CANARY }, 400)
    })
    const result = await resolveRegistryCredential(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'REAUTHENTICATION_REQUIRED' } })
    expect((await stored())?.status).toBe('reauth-required')
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('cancellation after refresh dispatch leaves the persisted uncertain fence', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const controller = new AbortController()
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        exchanges++
        controller.abort()
        throw new DOMException(CANARY, 'AbortError')
      }
      return json(profile())
    })
    const result = await resolveRegistryCredential(options(fetcher, { signal: controller.signal }))
    expect(result).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    expect(exchanges).toBe(1)
    const saved = await stored()
    expect(saved?.status).toBe('uncertain')
    if (saved?.status !== 'uncertain') expect.unreachable()
    expect(saved.refresh_attempts).toBe(1)
    expect(saved.refresh_token).toBe(REFRESH)
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })
})

describe('selected-session logout and failure retention', () => {
  test('revokes the bound bearer session and removes only selected OAuth state', async () => {
    await seed()
    let logoutRequest: Request | undefined
    let logoutInit: RequestInit | undefined
    const fetcher = makeFetch((request, init) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url.endsWith('/v0/auth/me')) return json(profile())
      logoutRequest = request
      logoutInit = init
      return json({ ok: true })
    })
    const result = await logoutCliSession(options(fetcher))
    expect(result).toEqual({ ok: true, value: { source: 'oauth', remoteRevocation: 'confirmed' } })
    expect(logoutRequest?.url).toBe(`${REGISTRY}/v0/auth/cli/logout`)
    expect(logoutRequest?.method).toBe('POST')
    expect(logoutRequest?.headers.get('authorization')).toBe(`Bearer ${accessToken()}`)
    expect(logoutRequest?.headers.get('cookie')).toBeNull()
    expect(logoutInit?.credentials).toBe('omit')
    expect(logoutInit?.redirect).toBe('error')
    expect(await stored()).toBeNull()
  })

  test('transient remote failure retains OAuth bytes; localOnly removes with an explicit warning', async () => {
    await seed()
    const original = readFileSync(statePath(), 'utf8')
    let logoutCalls = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url.endsWith('/v0/auth/me')) return json(profile())
      logoutCalls++
      return json({ code: 'E_REGISTRY_UNAVAILABLE', error: CANARY, fix: CANARY, docs_url: CANARY }, 503)
    })
    const transient = await logoutCliSession(options(fetcher))
    expect(transient).toEqual({ ok: false, error: { code: 'LOGOUT_UNAVAILABLE', status: 503 } })
    expect(readFileSync(statePath(), 'utf8')).toBe(original)
    expect(logoutCalls).toBe(1)
    const local = await logoutCliSession({ ...options(fetcher), localOnly: true })
    expect(local).toEqual({ ok: true, value: { source: 'oauth', remoteRevocation: 'unverified' } })
    expect(await stored()).toBeNull()
    expect(logoutCalls).toBe(1)
  })

  test('401 from explicit CLI logout cannot confirm remote revocation and retains state', async () => {
    await seed()
    const original = readFileSync(statePath(), 'utf8')
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url.endsWith('/v0/auth/me')) return json(profile())
      return json({ code: 'E_UNAUTHENTICATED', error: CANARY, fix: CANARY, docs_url: CANARY }, 401)
    })
    expect(await logoutCliSession(options(fetcher))).toEqual({
      ok: false,
      error: { code: 'LOGOUT_UNAVAILABLE', status: 401 },
    })
    expect(readFileSync(statePath(), 'utf8')).toBe(original)
  })

  test('terminal refresh invalid_grant is not a remote logout receipt', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let refreshCalls = 0
    let logoutCalls = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        refreshCalls++
        return json({ error: 'invalid_grant', error_description: CANARY }, 400)
      }
      if (request.url.endsWith('/v0/auth/cli/logout')) logoutCalls++
      return json({ ok: true })
    })
    const result = await logoutCliSession(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'REAUTHENTICATION_REQUIRED' } })
    expect(refreshCalls).toBe(1)
    expect(logoutCalls).toBe(0)
    expect((await stored())?.status).toBe('reauth-required')
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('auth-me 401 followed by logout 401 retains selected state', async () => {
    await seed()
    const original = readFileSync(statePath(), 'utf8')
    let logoutCalls = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url.endsWith('/v0/auth/me')) return json({ error: CANARY }, 401)
      logoutCalls++
      return json({ error: CANARY }, 401)
    })
    const result = await logoutCliSession(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'LOGOUT_UNAVAILABLE', status: 401 } })
    expect(logoutCalls).toBe(1)
    expect(readFileSync(statePath(), 'utf8')).toBe(original)
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('localOnly cleans a selected session during config outage with zero HTTP', async () => {
    await seed()
    let calls = 0
    const fetcher = makeFetch(() => {
      calls++
      return json({ error: CANARY }, 503)
    })
    const failedRemote = await logoutCliSession(options(fetcher))
    expect(failedRemote).toEqual({
      ok: false,
      error: { code: 'CONFIG_UNAVAILABLE', reason: 'CLI_CONFIG_UNAVAILABLE', status: 503 },
    })
    expect((await stored())?.status).toBe('ready')
    calls = 0
    const local = await logoutCliSession({ ...options(fetcher), localOnly: true })
    expect(local).toEqual({ ok: true, value: { source: 'oauth', remoteRevocation: 'unverified' } })
    expect(calls).toBe(0)
    expect(await stored()).toBeNull()
    expect(JSON.stringify(local)).not.toContain(CANARY)
  })

  test('localOnly retains an unsafe or wrong-origin selected candidate without HTTP', async () => {
    await seed()
    let calls = 0
    const fetcher = makeFetch(() => {
      calls++
      return json(configResponse())
    })
    const mismatched = { ...ready(), registry_origin: OTHER_REGISTRY }
    writeFileSync(statePath(), `${JSON.stringify(mismatched)}\n`)
    const wrongOrigin = await logoutCliSession({ ...options(fetcher), localOnly: true })
    expect(wrongOrigin).toEqual({ ok: false, error: { code: 'STATE_UNAVAILABLE', reason: 'INVALID_SESSION' } })
    expect(readFileSync(statePath(), 'utf8')).toContain(OTHER_REGISTRY)

    rmSync(statePath())
    symlinkSync(join(facetDir, 'missing.json'), statePath())
    const unsafe = await logoutCliSession({ ...options(fetcher), localOnly: true })
    expect(unsafe).toEqual({ ok: false, error: { code: 'STATE_UNAVAILABLE', reason: 'UNSAFE_STATE' } })
    expect(calls).toBe(0)
  })

  test('localOnly cannot delete a new session that replaced its pre-lock candidate', async () => {
    await seed()
    let holderReady = () => {}
    const holding = new Promise<void>((resolve) => {
      holderReady = resolve
    })
    let releaseHolder = () => {}
    const held = new Promise<void>((resolve) => {
      releaseHolder = resolve
    })
    const holder = withOAuthSessionLock(binding(), async (lock) => {
      holderReady()
      await held
      const removed = await deleteOAuthSession(binding(), 1, lock)
      if (!removed.ok) return removed
      const replacement = ready({ generation: 3, user_uuid: 'replacement-user', refresh_token: 'replacement-refresh' })
      return saveOAuthSession(replacement, 2, lock)
    })
    await holding

    let contenderReady = () => {}
    const contending = new Promise<void>((resolve) => {
      contenderReady = resolve
    })
    const originalExec = Database.prototype.exec
    const exec = spyOn(Database.prototype, 'exec').mockImplementation(function (this: Database, sql) {
      if (sql === 'BEGIN IMMEDIATE') contenderReady()
      return originalExec.call(this, sql)
    })
    let calls = 0
    const fetcher = makeFetch(() => {
      calls++
      return json(configResponse())
    })
    const pending = logoutCliSession({ ...options(fetcher), localOnly: true })
    try {
      await Promise.race([contending, Bun.sleep(2_000).then(() => expect.unreachable('contender did not reach lock'))])
      releaseHolder()
      expect((await holder).ok).toBe(true)
      expect(await pending).toEqual({ ok: false, error: { code: 'SESSION_CHANGED' } })
      expect((await stored())?.user_uuid).toBe('replacement-user')
      expect((await stored())?.generation).toBe(3)
      expect(calls).toBe(0)
    } finally {
      releaseHolder()
      exec.mockRestore()
    }
  })

  test('a malformed successful logout response is not a revocation receipt', async () => {
    await seed()
    const original = readFileSync(statePath(), 'utf8')
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url.endsWith('/v0/auth/me')) return json(profile())
      return json({ ok: false, error: CANARY })
    })
    const result = await logoutCliSession(options(fetcher))
    expect(result).toEqual({ ok: false, error: { code: 'LOGOUT_UNAVAILABLE', status: 200 } })
    expect(readFileSync(statePath(), 'utf8')).toBe(original)
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('legacy PAT logout removes its file without changing a selected OAuth session', async () => {
    await seed()
    writeCredentialsToken('saved-pat')
    let calls = 0
    const fetcher = makeFetch(() => {
      calls++
      return json(configResponse())
    })
    expect(await logoutCliSession(options(fetcher))).toEqual({
      ok: true,
      value: { source: 'pat', removed: true, envActive: false },
    })
    expect((await stored())?.status).toBe('ready')
    expect(calls).toBe(0)
  })

  test('concurrent refresh finishes before logout and logout revokes the rotated bearer', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let releaseRefresh: (() => void) | undefined
    let notifyRefresh: (() => void) | undefined
    const reachedRefresh = new Promise<void>((resolve) => {
      notifyRefresh = resolve
    })
    const heldRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const bearerTokens: string[] = []
    const fetcher = makeFetch(async (request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        notifyRefresh?.()
        await heldRefresh
        return json(tokenResponse(accessToken({ jti: 'rotated' })))
      }
      if (request.url.endsWith('/v0/auth/me')) return json(profile())
      bearerTokens.push(request.headers.get('authorization') ?? '')
      return json({ ok: true })
    })
    const setup = options(fetcher)
    const refreshing = resolveRegistryCredential(setup)
    await reachedRefresh
    const loggingOut = logoutCliSession(setup)
    releaseRefresh?.()
    const [refreshed, loggedOut] = await Promise.all([refreshing, loggingOut])
    expect(refreshed.ok).toBe(true)
    expect(loggedOut).toEqual({ ok: true, value: { source: 'oauth', remoteRevocation: 'confirmed' } })
    expect(bearerTokens).toEqual([`Bearer ${accessToken({ jti: 'rotated' })}`])
    expect(await stored()).toBeNull()
  })

  test('a replacement begun during refresh cannot overwrite the rotated session', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let releaseRefresh: (() => void) | undefined
    let notifyRefresh: (() => void) | undefined
    const reachedRefresh = new Promise<void>((resolve) => {
      notifyRefresh = resolve
    })
    const heldRefresh = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const fetcher = makeFetch(async (request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      if (request.url === TOKEN_ENDPOINT) {
        const grant = new URLSearchParams(await request.text()).get('grant_type')
        if (grant === 'refresh_token') {
          notifyRefresh?.()
          await heldRefresh
          return json(tokenResponse(accessToken({ jti: 'rotated' })))
        }
        return json(tokenResponse(accessToken({ jti: 'new-login' }), 'new-login-refresh'))
      }
      return json(profile())
    })
    const setup = options(fetcher)
    const refreshing = resolveRegistryCredential(setup)
    await reachedRefresh
    const begun = await beginCliLogin(setup)
    if (!begun.ok) expect.unreachable()
    const completing = completeCliLogin(begun.value, setup)
    releaseRefresh?.()
    const [refreshed, completed] = await Promise.all([refreshing, completing])
    expect(refreshed.ok).toBe(true)
    expect(completed).toEqual({ ok: false, error: { code: 'SESSION_CHANGED' } })
    const saved = await stored()
    expect(saved?.status).toBe('ready')
    expect(saved?.refresh_token).toBe(ROTATED)
  })

  test('failed promotion retains quarantined pair and does not expose new tokens', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const oauthRoot = join(facetDir, 'oauth')
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      chmodSync(oauthRoot, 0o500)
      return json(profile())
    })
    let result: Awaited<ReturnType<typeof resolveRegistryCredential>>
    try {
      result = await resolveRegistryCredential(options(fetcher))
    } finally {
      chmodSync(oauthRoot, 0o700)
    }
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('STATE_UNAVAILABLE')
    const saved = await stored()
    expect(saved?.status).toBe('verification-pending')
    expect(saved?.refresh_token).toBe(ROTATED)
    expect(JSON.stringify(result)).not.toContain(ROTATED)
  })
})

describe('real multi-process refresh coordination', () => {
  const moduleUrl = new URL('../oauth-session.ts', import.meta.url).href
  const workerSource = `
    import { appendFileSync } from 'node:fs'
    import { resolveRegistryCredential } from ${JSON.stringify(moduleUrl)}
    const config = JSON.parse(process.env.TEST_CONFIG_JSON ?? '{}')
    const tokens = JSON.parse(process.env.TEST_TOKENS_JSON ?? '{}')
    const profile = JSON.parse(process.env.TEST_PROFILE_JSON ?? '{}')
    const registry = process.env.TEST_REGISTRY ?? ''
    const endpoint = process.env.TEST_TOKEN_ENDPOINT ?? ''
    const logPath = process.env.TEST_REFRESH_LOG ?? ''
    const fetcher = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init)
      if (request.url.endsWith('/v0/auth/cli/config')) return new Response(JSON.stringify(config), { status: 200 })
      if (request.url === endpoint) {
        appendFileSync(logPath, 'refresh\\n')
        if (process.env.TEST_CRASH === '1') process.exit(0)
        await Bun.sleep(30)
        return new Response(JSON.stringify(tokens), { status: 200 })
      }
      if (request.url.endsWith('/v0/auth/me')) return new Response(JSON.stringify(profile), { status: 200 })
      return new Response('{}', { status: 404 })
    }
    fetcher.preconnect = globalThis.fetch.preconnect
    const result = await resolveRegistryCredential({ registryUrl: registry, fetch: fetcher, now: () => Number(process.env.TEST_NOW) })
    process.stdout.write(JSON.stringify(result.ok
      ? { ok: true, source: result.value.source, registryOrigin: result.value.source === 'oauth' ? result.value.registryOrigin : null }
      : { ok: false, error: result.error }))
    process.exitCode = result.ok ? 0 : 1
  `

  async function launchWorkers(count: number, logPath: string, crash = false) {
    const env = {
      ...process.env,
      FACET_DIR: facetDir,
      FACET_TOKEN: '',
      FACET_REGISTRY_URL: REGISTRY,
      TEST_CONFIG_JSON: JSON.stringify(configResponse()),
      TEST_TOKENS_JSON: JSON.stringify(tokenResponse(accessToken({ jti: 'rotated' }))),
      TEST_PROFILE_JSON: JSON.stringify(profile()),
      TEST_REGISTRY: REGISTRY,
      TEST_TOKEN_ENDPOINT: TOKEN_ENDPOINT,
      TEST_REFRESH_LOG: logPath,
      TEST_NOW: String(NOW),
      TEST_CRASH: crash ? '1' : '0',
    }
    const workers = Array.from({ length: count }, () =>
      Bun.spawn([process.execPath, '-e', workerSource], { env, stdout: 'pipe', stderr: 'pipe' }),
    )
    return Promise.all(
      workers.map(async (worker) => ({
        exitCode: await worker.exited,
        stdout: await new Response(worker.stdout).text(),
        stderr: await new Response(worker.stderr).text(),
      })),
    )
  }

  test.each([2, 20])('%i independent processes converge on one exchange and one rotated pair', async (count) => {
    await seed(ready({ expires_at: NOW - 1 }))
    const logPath = join(facetDir, 'refresh-calls.log')
    writeFileSync(logPath, '')
    const workers = await launchWorkers(count, logPath)
    for (const worker of workers) {
      if (worker.exitCode !== 0) {
        let diagnostic = `stdout=${worker.stdout}; stderr=${worker.stderr}`
        for (const secret of [REFRESH, ROTATED, DEVICE, CANARY, accessToken(), accessToken({ jti: 'rotated' })]) {
          diagnostic = diagnostic.replaceAll(secret, '[redacted]')
        }
        throw new Error(`refresh worker exited ${worker.exitCode}: ${diagnostic.slice(0, 1_000)}`)
      }
      expect(worker.exitCode).toBe(0)
      expect(worker.stderr).toBe('')
      expect(JSON.parse(worker.stdout)).toEqual({ ok: true, source: 'oauth', registryOrigin: REGISTRY })
    }
    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual(['refresh'])
    const saved = await stored()
    expect(saved?.status).toBe('ready')
    expect(saved?.refresh_token).toBe(ROTATED)
    expect(saved?.access_token).toBe(accessToken({ jti: 'rotated' }))
  }, 40_000)

  test('a crashed first dispatcher leaves a durable fence that a later process can resume once', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const logPath = join(facetDir, 'refresh-calls.log')
    writeFileSync(logPath, '')
    const crashed = await launchWorkers(1, logPath, true)
    expect(crashed[0]?.exitCode).toBe(0)
    const uncertain = await stored()
    expect(uncertain?.status).toBe('uncertain')
    if (uncertain?.status !== 'uncertain') expect.unreachable()
    expect(uncertain.refresh_attempts).toBe(1)
    expect(uncertain.refresh_started_at).toBe(NOW)
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        writeFileSync(logPath, 'refresh\n', { flag: 'a' })
        return json(tokenResponse(accessToken({ jti: 'rotated' })))
      }
      return json(profile())
    })
    const resumed = await resolveRegistryCredential(options(fetcher))
    expect(resumed.ok).toBe(true)
    expect(readFileSync(logPath, 'utf8').trim().split('\n')).toEqual(['refresh', 'refresh'])
    expect((await stored())?.status).toBe('ready')
  }, 20_000)
})

describe('durable session lifecycle regressions', () => {
  test('a login begun absent cannot restore a session after another login and logout', async () => {
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      return json(profile())
    })
    const older = await beginCliLogin(options(fetcher))
    const newer = await beginCliLogin(options(fetcher))
    if (!older.ok || !newer.ok) expect.unreachable()
    expect((await completeCliLogin(newer.value, options(fetcher))).ok).toBe(true)
    expect((await logoutCliSession({ ...options(fetcher), localOnly: true })).ok).toBe(true)
    expect(await completeCliLogin(older.value, options(fetcher))).toEqual({
      ok: false,
      error: { code: 'SESSION_CHANGED' },
    })
    expect(await stored()).toBeNull()
  })

  test('retains a successful rotation through profile outage beyond the old replay window', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let clock = NOW
    let unavailable = true
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        exchanges++
        return json(tokenResponse())
      }
      return unavailable ? json({ code: 'E_OUTAGE' }, 503) : json(profile())
    })
    const setup = options(fetcher, { now: () => clock })
    expect(await resolveRegistryCredential(setup)).toEqual({
      ok: false,
      error: { code: 'REGISTRY_VERIFICATION_FAILED', status: 503 },
    })
    expect((await stored())?.status).toBe('verification-pending')
    expect((await stored())?.refresh_token).toBe(ROTATED)
    clock += 31_000
    unavailable = false
    const resumed = await resolveRegistryCredential(setup)
    if (!resumed.ok) expect.unreachable()
    expect(resumed.value.source).toBe('oauth')
    expect(exchanges).toBe(1)
    expect((await stored())?.status).toBe('ready')
  })
})

describe('durable cross-process lifecycle', () => {
  const moduleUrl = new URL('../oauth-session.ts', import.meta.url).href
  const worker = `
    import { appendFileSync, writeFileSync } from 'node:fs'
    import { beginCliLogin, completeCliLogin, logoutCliSession, resolveRegistryCredential } from ${JSON.stringify(moduleUrl)}
    const config = JSON.parse(process.env.TEST_CONFIG_JSON ?? '{}')
    const tokens = JSON.parse(process.env.TEST_TOKENS_JSON ?? '{}')
    const profile = JSON.parse(process.env.TEST_PROFILE_JSON ?? '{}')
    const device = JSON.parse(process.env.TEST_DEVICE_JSON ?? '{}')
    const clock = Number(process.env.TEST_NOW)
    const mode = process.env.TEST_MODE
    const fetcher = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init)
      let body
      if (request.url.endsWith('/v0/auth/cli/config')) body = config
      else if (request.url === config.authorization_endpoint) body = device
      else if (request.url === config.token_endpoint) {
        appendFileSync(process.env.TEST_LOG, 'exchange\\n')
        body = tokens
      } else {
        if (mode === 'crash-pending') {
          writeFileSync(process.env.TEST_MARKER, 'pending-durable')
          await new Promise(() => {})
        }
        body = profile
      }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    fetcher.preconnect = globalThis.fetch.preconnect
    const options = { registryUrl: process.env.FACET_REGISTRY_URL, fetch: fetcher, now: () => clock, sleep: async () => {} }
    let result
    if (mode === 'login-logout') {
      const begun = await beginCliLogin(options)
      if (!begun.ok) throw new Error(begun.error.code)
      const completed = await completeCliLogin(begun.value, options)
      if (!completed.ok) throw new Error(completed.error.code)
      result = await logoutCliSession({ ...options, localOnly: true })
    } else result = await resolveRegistryCredential(options)
    process.stdout.write(JSON.stringify(result.ok ? { ok: true, source: result.value.source } : { ok: false, error: result.error }))
    process.exitCode = result.ok ? 0 : 1
  `

  function spawn(mode: string, clock = NOW) {
    return Bun.spawn([process.execPath, '-e', worker], {
      env: {
        ...process.env,
        FACET_DIR: facetDir,
        FACET_TOKEN: '',
        FACET_REGISTRY_URL: REGISTRY,
        TEST_CONFIG_JSON: JSON.stringify(configResponse()),
        TEST_TOKENS_JSON: JSON.stringify(tokenResponse()),
        TEST_PROFILE_JSON: JSON.stringify(profile()),
        TEST_DEVICE_JSON: JSON.stringify(deviceResponse()),
        TEST_NOW: String(clock),
        TEST_MODE: mode,
        TEST_LOG: join(facetDir, 'lifecycle-exchanges.log'),
        TEST_MARKER: join(facetDir, 'pending.marker'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
  }

  async function finished(child: ReturnType<typeof spawn>) {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    return JSON.parse(stdout)
  }

  test('absent login in this process loses CAS after equivalent login/logout in another process', async () => {
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      return json(profile())
    })
    const begun = await beginCliLogin(options(fetcher))
    if (!begun.ok) expect.unreachable()
    expect(await finished(spawn('login-logout'))).toEqual({ ok: true, source: 'oauth' })
    expect(await completeCliLogin(begun.value, options(fetcher))).toEqual({
      ok: false,
      error: { code: 'SESSION_CHANGED' },
    })
    expect(await stored()).toBeNull()
    const tombstone = JSON.parse(readFileSync(statePath(), 'utf8'))
    expect(tombstone.generation).toBe(2)
    expect(Object.keys(tombstone).sort()).toEqual([
      'authorization_endpoint',
      'client_id',
      'generation',
      'issuer',
      'registry_origin',
      'status',
      'token_endpoint',
      'verification_origin',
      'version',
    ])
    expect(await finished(spawn('resolve', NOW + 31_000))).toEqual({ ok: true, source: 'absent' })
  }, 10_000)

  test('a fresh process verifies retained rotation beyond the old replay deadline without another exchange', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      return json({ code: 'E_OUTAGE' }, 503)
    })
    expect((await resolveRegistryCredential(options(fetcher))).ok).toBe(false)
    expect((await stored())?.refresh_token).toBe(ROTATED)
    expect(await finished(spawn('resolve', NOW + 31_000))).toEqual({ ok: true, source: 'oauth' })
    expect(await Bun.file(join(facetDir, 'lifecycle-exchanges.log')).exists()).toBe(false)
    expect((await stored())?.status).toBe('ready')
  }, 10_000)

  test('SIGKILL after pending persistence releases the lock and another process recovers the pair', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const child = spawn('crash-pending')
    try {
      const deadline = Date.now() + 5_000
      while (!(await Bun.file(join(facetDir, 'pending.marker')).exists())) {
        if (Date.now() >= deadline) expect.unreachable('worker did not persist pending state')
        await Bun.sleep(5)
      }
      expect((await stored())?.status).toBe('verification-pending')
      expect((await stored())?.refresh_token).toBe(ROTATED)
      child.kill('SIGKILL')
      expect(await child.exited).not.toBe(0)
      expect(await finished(spawn('resolve', NOW + 31_000))).toEqual({ ok: true, source: 'oauth' })
      expect(readFileSync(join(facetDir, 'lifecycle-exchanges.log'), 'utf8')).toBe('exchange\n')
    } finally {
      child.kill('SIGKILL')
      await child.exited
    }
  }, 10_000)
})

describe('pending rotation trust and lifecycle', () => {
  test.each([
    401,
    503,
    'mismatch',
    'onboarding',
  ] as const)('never exposes pending credentials for profile outcome %s', async (outcome) => {
    await seed(ready({ expires_at: NOW - 1 }))
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      if (outcome === 'mismatch') return json(profile('other-user'))
      if (outcome === 'onboarding') return json({ code: 'E_ONBOARDING_REQUIRED' }, 409)
      return json({ code: 'E_OUTAGE' }, outcome)
    })
    const result = await resolveRegistryCredential(options(fetcher))
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe(
      outcome === 'mismatch'
        ? 'IDENTITY_MISMATCH'
        : outcome === 'onboarding'
          ? 'ONBOARDING_REQUIRED'
          : 'REGISTRY_VERIFICATION_FAILED',
    )
    expect((await stored())?.status).toBe('verification-pending')
    expect((await stored())?.refresh_token).toBe(ROTATED)
    expect((await stored())?.user_uuid).toBe('registry-user-uuid')
    expect(JSON.stringify(result)).not.toContain(ROTATED)
  })

  test('expired pending access uses retained refresh token and a fresh bounded exchange', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let clock = NOW
    const sent: Array<string | null> = []
    const fetcher = makeFetch(async (request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        sent.push(new URLSearchParams(await request.text()).get('refresh_token'))
        return json(tokenResponse(sent.length === 1 ? accessToken({ exp: NOW / 1_000 + 1 }) : accessToken(), ROTATED))
      }
      return sent.length === 1 ? json({ code: 'E_OUTAGE' }, 503) : json(profile())
    })
    const setup = options(fetcher, { now: () => clock })
    expect((await resolveRegistryCredential(setup)).ok).toBe(false)
    clock += 31_000
    expect((await resolveRegistryCredential(setup)).ok).toBe(true)
    expect(sent).toEqual([REFRESH, ROTATED])
    expect((await stored())?.status).toBe('ready')
    expect((await stored())?.user_uuid).toBe('registry-user-uuid')
  })

  test('caller interruption before token body knowledge retains the uncertain old pair', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const controller = new AbortController()
    let profiles = 0
    let exchanges = 0
    let reads = 0
    let cancelled = 0
    let backoffs = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        exchanges++
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(stream) {
              reads++
              stream.enqueue(new TextEncoder().encode('{"access_token":'))
              controller.abort()
            },
            cancel() {
              cancelled++
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      profiles++
      return json(profile())
    })
    expect(
      await resolveRegistryCredential(
        options(fetcher, {
          signal: controller.signal,
          sleep: async () => {
            backoffs++
          },
        }),
      ),
    ).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    expect({ exchanges, profiles, backoffs, reads, cancelled }).toEqual({
      exchanges: 1,
      profiles: 0,
      backoffs: 0,
      reads: 1,
      cancelled: 1,
    })
    expect(await stored()).toMatchObject({
      status: 'uncertain',
      refresh_token: REFRESH,
      refresh_started_at: NOW,
      refresh_attempts: 1,
    })
  })

  test('caller cancellation at the real successful pending write retains known pair before profile', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const controller = new AbortController()
    let profiles = 0
    let pendingWrites = 0
    const originalSave = oauthStore.saveOAuthSession
    const saveProbe = spyOn(oauthStore, 'saveOAuthSession').mockImplementation(async (...args) => {
      const result = await originalSave(...args)
      if (result.ok && args[0].status === 'verification-pending') {
        expect(await stored()).toMatchObject({ status: 'verification-pending', refresh_token: ROTATED })
        pendingWrites++
        controller.abort()
      }
      return result
    })
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      profiles++
      return json(profile())
    })
    try {
      expect(await resolveRegistryCredential(options(fetcher, { signal: controller.signal }))).toEqual({
        ok: false,
        error: { code: 'CANCELLED' },
      })
      expect({ profiles, pendingWrites }).toEqual({ profiles: 0, pendingWrites: 1 })
      expect(await stored()).toMatchObject({
        status: 'verification-pending',
        refresh_token: ROTATED,
        user_uuid: 'registry-user-uuid',
      })
    } finally {
      saveProbe.mockRestore()
    }
  })

  test('failed pending save retains old uncertain fence and never requests a profile', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    let profiles = 0
    const root = join(facetDir, 'oauth')
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) {
        chmodSync(root, 0o500)
        return json(tokenResponse())
      }
      profiles++
      return json(profile())
    })
    let result: Awaited<ReturnType<typeof resolveRegistryCredential>>
    try {
      result = await resolveRegistryCredential(options(fetcher))
    } finally {
      chmodSync(root, 0o700)
    }
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('STATE_UNAVAILABLE')
    expect(profiles).toBe(0)
    expect((await stored())?.status).toBe('uncertain')
    expect((await stored())?.refresh_token).toBe(REFRESH)
    expect(JSON.stringify(result)).not.toContain(ROTATED)
  })

  test('new config login may replace per-origin tombstone while an old attempt remains fenced', async () => {
    const newClient = 'client_new_configuration'
    const newIssuer = `https://api.workos.com/user_management/${newClient}`
    let changed = false
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/v0/auth/cli/config'))
        return json(changed ? configResponse({ client_id: newClient, issuer: newIssuer }) : configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      if (request.url === TOKEN_ENDPOINT)
        return json(tokenResponse(changed ? accessToken({ client_id: newClient, iss: newIssuer }) : accessToken()))
      return json(profile())
    })
    const older = await beginCliLogin(options(fetcher))
    const newer = await beginCliLogin(options(fetcher))
    if (!older.ok || !newer.ok) expect.unreachable()
    expect((await completeCliLogin(newer.value, options(fetcher))).ok).toBe(true)
    expect((await logoutCliSession({ ...options(fetcher), localOnly: true })).ok).toBe(true)
    changed = true
    const replacement = await beginCliLogin(options(fetcher))
    if (!replacement.ok) expect.unreachable()
    expect((await completeCliLogin(replacement.value, options(fetcher))).ok).toBe(true)
    const current = await readOAuthSession(binding(REGISTRY, newClient))
    if (!current.ok) expect.unreachable()
    expect(current.value?.generation).toBe(3)
    expect(current.value?.client_id).toBe(newClient)
    changed = false
    const stale = await completeCliLogin(older.value, options(fetcher))
    if (stale.ok) expect.unreachable()
    expect(stale.error.code).toBe('STATE_UNAVAILABLE')
    expect((await readOAuthSession(binding(REGISTRY, newClient))).ok).toBe(true)
  })
})

describe('facade caller cancellation and composed transport', () => {
  test('preaborted OAuth actions make zero requests while PAT precedence remains active', async () => {
    await seed()
    const controller = new AbortController()
    controller.abort()
    let dispatches = 0
    const fetcher = makeFetch(() => {
      dispatches++
      return json(configResponse())
    })
    const setup = options(fetcher, { signal: controller.signal })
    const cancelled: { ok: false; error: { code: 'CANCELLED' } } = { ok: false, error: { code: 'CANCELLED' } }
    expect(await beginCliLogin(setup)).toEqual(cancelled)
    expect(await resolveRegistryCredential(setup)).toEqual(cancelled)
    expect(await logoutCliSession(setup)).toEqual(cancelled)
    expect(await logoutCliSession({ ...setup, localOnly: true })).toEqual(cancelled)
    expect(dispatches).toBe(0)
    expect(await stored()).toMatchObject({ status: 'ready', generation: 1 })
    process.env.FACET_TOKEN = CANARY
    expect(await resolveRegistryCredential(setup)).toEqual({ ok: true, value: { source: 'env', token: CANARY } })
    expect(await logoutCliSession(setup)).toEqual({
      ok: true,
      value: { source: 'pat', removed: false, envActive: true },
    })
    expect(dispatches).toBe(0)
  })

  for (const action of ['begin', 'resolve', 'logout']) {
    test(`caller cancellation through config body normalizes ${action}`, async () => {
      await seed()
      const controller = new AbortController()
      let dispatches = 0
      let receivedSignal: AbortSignal | undefined
      const fetcher = makeFetch((request) => {
        dispatches++
        receivedSignal = request.signal
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(stream) {
              controller.abort()
              stream.error(new DOMException('caller abort', 'AbortError'))
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      })
      const setup = options(fetcher, { signal: controller.signal })
      const result =
        action === 'begin'
          ? await beginCliLogin(setup)
          : action === 'resolve'
            ? await resolveRegistryCredential(setup)
            : await logoutCliSession(setup)
      expect(result).toEqual({ ok: false, error: { code: 'CANCELLED' } })
      expect(receivedSignal?.aborted).toBe(true)
      expect(dispatches).toBe(1)
      expect(await stored()).toMatchObject({ status: 'ready', generation: 1 })
    })
  }

  for (const stage of ['profile', 'logout']) {
    test(`caller cancellation during ${stage} body retains durable session`, async () => {
      await seed()
      const controller = new AbortController()
      const dispatched: string[] = []
      const fetcher = makeFetch((request) => {
        dispatched.push(new URL(request.url).pathname)
        if (request.url.endsWith('/config')) return json(configResponse())
        if (stage === 'logout' && request.url.endsWith('/me')) return json(profile())
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(stream) {
              controller.abort()
              stream.error(new DOMException('caller abort', 'AbortError'))
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      })
      const setup = options(fetcher, { signal: controller.signal })
      expect(stage === 'profile' ? await resolveRegistryCredential(setup) : await logoutCliSession(setup)).toEqual({
        ok: false,
        error: { code: 'CANCELLED' },
      })
      expect(dispatched).toEqual(
        stage === 'profile'
          ? ['/v0/auth/cli/config', '/v0/auth/me']
          : ['/v0/auth/cli/config', '/v0/auth/me', '/v0/auth/cli/logout'],
      )
      expect(await stored()).toMatchObject({ status: 'ready', generation: 1, refresh_token: REFRESH })
    })
  }

  test('cancelled refresh backoff retains the first durable attempt and cannot dispatch again', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const controller = new AbortController()
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/config')) return json(configResponse())
      exchanges++
      throw new TypeError('network')
    })
    expect(
      await resolveRegistryCredential(
        options(fetcher, {
          signal: controller.signal,
          sleep: async (_milliseconds, signal) => {
            expect(signal).toBe(controller.signal)
            controller.abort()
            throw new DOMException('caller abort', 'AbortError')
          },
        }),
      ),
    ).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    expect(exchanges).toBe(1)
    expect(await stored()).toMatchObject({ status: 'uncertain', refresh_attempts: 1, refresh_token: REFRESH })
  })

  test('cancellation of the final refresh body is CANCELLED without a fourth dispatch', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const controller = new AbortController()
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/config')) return json(configResponse())
      exchanges++
      if (exchanges < 3) throw new TypeError('network')
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(stream) {
            controller.abort()
            stream.error(new DOMException('caller abort', 'AbortError'))
          },
        }),
      )
    })
    expect(await resolveRegistryCredential(options(fetcher, { signal: controller.signal }))).toEqual({
      ok: false,
      error: { code: 'CANCELLED' },
    })
    expect(exchanges).toBe(3)
    expect(await stored()).toMatchObject({ status: 'uncertain', refresh_attempts: 3, refresh_token: REFRESH })
  })

  test('poll cancellation returns the facade code and never verifies or stores', async () => {
    const controller = new AbortController()
    let exchanges = 0
    const fetcher = makeFetch((request) => {
      if (request.url.endsWith('/config')) return json(configResponse())
      if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
      exchanges++
      return json(profile())
    })
    const setup = options(fetcher, {
      signal: controller.signal,
      sleep: async () => {
        controller.abort()
        throw new DOMException('caller abort', 'AbortError')
      },
    })
    const attempt = await beginCliLogin(setup)
    if (!attempt.ok) expect.unreachable()
    expect(await completeCliLogin(attempt.value, setup)).toEqual({ ok: false, error: { code: 'CANCELLED' } })
    expect(exchanges).toBe(0)
    expect(await stored()).toBeNull()
  })

  for (const bodyFailure of ['network', 'timeout']) {
    test(`real low-level HTTP200 ${bodyFailure} body failure replays same RT at most three before UUID proof`, async () => {
      await seed(ready({ expires_at: NOW - 1 }))
      let clock = NOW
      const retiredTokens: Array<string | null> = []
      let profiles = 0
      const fetcher = makeFetch(async (request) => {
        if (request.url.endsWith('/config')) return json(configResponse())
        if (request.url === TOKEN_ENDPOINT) {
          retiredTokens.push(new URLSearchParams(await request.text()).get('refresh_token'))
          if (retiredTokens.length < 3)
            return new Response(
              new ReadableStream<Uint8Array>({
                pull(stream) {
                  clock += 1_000
                  stream.error(
                    bodyFailure === 'network'
                      ? new TypeError('network')
                      : new DOMException('request deadline', 'TimeoutError'),
                  )
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            )
          return json(tokenResponse())
        }
        profiles++
        expect(request.headers.get('authorization')).toBe(`Bearer ${accessToken()}`)
        expect(await stored()).toMatchObject({ status: 'verification-pending', refresh_token: ROTATED })
        return json(profile())
      })
      const result = await resolveRegistryCredential(
        options(fetcher, {
          now: () => clock,
          sleep: async (milliseconds) => {
            clock += milliseconds
          },
        }),
      )
      if (!result.ok) expect.unreachable()
      expect(result.value).toMatchObject({ source: 'oauth', profile: { user_uuid: 'registry-user-uuid' } })
      expect(retiredTokens).toEqual([REFRESH, REFRESH, REFRESH])
      expect(profiles).toBe(1)
      expect(clock - NOW).toBeLessThan(25_000)
      expect(await stored()).toMatchObject({ status: 'ready', refresh_token: ROTATED, user_uuid: 'registry-user-uuid' })
    })
  }

  test('request-owned config/profile/logout timeouts remain unavailable without caller cancellation', async () => {
    await seed()
    for (const stage of ['config', 'profile', 'logout']) {
      const fetcher = makeFetch((request) => {
        if (stage !== 'config' && request.url.endsWith('/config')) return json(configResponse())
        if (stage === 'logout' && request.url.endsWith('/me')) return json(profile())
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(stream) {
              stream.error(new DOMException('request deadline', 'TimeoutError'))
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      })
      const result =
        stage === 'logout'
          ? await logoutCliSession(options(fetcher))
          : await resolveRegistryCredential(options(fetcher))
      if (result.ok) expect.unreachable()
      expect(result.error.code).toBe(
        stage === 'config'
          ? 'CONFIG_UNAVAILABLE'
          : stage === 'profile'
            ? 'REGISTRY_VERIFICATION_FAILED'
            : 'LOGOUT_UNAVAILABLE',
      )
      expect(await stored()).toMatchObject({ status: 'ready', generation: 1 })
    }
  })
})

describe('cancellation persistence and stale opened candidates', () => {
  test('profile body cancellation after a known exchange retains the quarantined pair', async () => {
    await seed(ready({ expires_at: NOW - 1 }))
    const controller = new AbortController()
    let profiles = 0
    const fetcher = makeFetch(async (request) => {
      if (request.url.endsWith('/config')) return json(configResponse())
      if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
      profiles++
      expect(await stored()).toMatchObject({ status: 'verification-pending', refresh_token: ROTATED })
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(stream) {
            controller.abort()
            stream.error(new DOMException('caller abort', 'AbortError'))
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    expect(await resolveRegistryCredential(options(fetcher, { signal: controller.signal }))).toEqual({
      ok: false,
      error: { code: 'CANCELLED' },
    })
    expect(profiles).toBe(1)
    expect(await stored()).toMatchObject({ status: 'verification-pending', refresh_token: ROTATED })
  })

  for (const action of ['resolve', 'complete']) {
    test(`cancellation during verified ready persistence never emits ${action} success`, async () => {
      await seed(ready({ expires_at: NOW - 1 }))
      const controller = new AbortController()
      const fetcher = makeFetch((request) => {
        if (request.url.endsWith('/config')) return json(configResponse())
        if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
        if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
        return json(profile())
      })
      const setup = options(fetcher, { signal: controller.signal })
      const attempt = action === 'complete' ? await beginCliLogin(setup) : undefined
      const originalSave = oauthStore.saveOAuthSession
      let readyWrites = 0
      const saveProbe = spyOn(oauthStore, 'saveOAuthSession').mockImplementation(async (...args) => {
        const result = await originalSave(...args)
        if (result.ok && args[0].status === 'ready') {
          readyWrites++
          expect(await stored()).toMatchObject({ status: 'ready', refresh_token: ROTATED })
          controller.abort()
        }
        return result
      })
      try {
        let result: Awaited<ReturnType<typeof resolveRegistryCredential>> | Awaited<ReturnType<typeof completeCliLogin>>
        if (action === 'complete') {
          if (attempt === undefined || !attempt.ok) expect.unreachable()
          result = await completeCliLogin(attempt.value, setup)
        } else result = await resolveRegistryCredential(setup)
        expect(result).toEqual({ ok: false, error: { code: 'CANCELLED' } })
        expect(readyWrites).toBe(1)
      } finally {
        saveProbe.mockRestore()
      }
    })
  }

  for (const action of ['resolve', 'begin']) {
    test(`opened candidate unlinked by logout cannot restore or emit credentials via ${action}`, async () => {
      await seed()
      const originalOpen = fsPromises.open
      let deleted = false
      let openedLinks: number | undefined
      let profiles = 0
      const openProbe = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
        const handle = await originalOpen(...args)
        if (args[0] === statePath() && !deleted) {
          deleted = true
          const removal = await withOAuthSessionLock(binding(), (lock) => deleteOAuthSession(binding(), 1, lock))
          expect(removal.ok).toBe(true)
          openedLinks = (await handle.stat()).nlink
        }
        return handle
      })
      const fetcher = makeFetch((request) => {
        if (request.url.endsWith('/config')) return json(configResponse())
        if (request.url === AUTHORIZATION_ENDPOINT) return json(deviceResponse())
        if (request.url === TOKEN_ENDPOINT) return json(tokenResponse())
        profiles++
        return json(profile())
      })
      try {
        if (action === 'resolve') {
          expect(await resolveRegistryCredential(options(fetcher))).toEqual({
            ok: false,
            error: { code: 'SESSION_CHANGED' },
          })
        } else {
          const attempt = await beginCliLogin(options(fetcher))
          if (!attempt.ok) expect.unreachable()
          expect(await completeCliLogin(attempt.value, options(fetcher))).toEqual({
            ok: false,
            error: { code: 'SESSION_CHANGED' },
          })
        }
        expect(openedLinks).toBe(0)
        expect(profiles).toBe(0)
        expect(await stored()).toBeNull()
      } finally {
        openProbe.mockRestore()
      }
    })
  }
})
