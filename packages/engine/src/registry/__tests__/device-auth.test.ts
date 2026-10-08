import { describe, expect, test } from 'bun:test'
import type { CliAuthConfig } from '../cli-config.ts'
import {
  type DeviceAuthorizationChallenge,
  type DeviceTokenPair,
  pollDeviceAuthorization,
  refreshDeviceTokens,
  requestDeviceAuthorization,
} from '../device-auth.ts'

const CLIENT_ID = 'client_01HZXYPJYQ8V7Z9M4G3K2N1P0R'
const DEVICE_CODE = 'device-secret-code'
const REFRESH_TOKEN = 'refresh-secret-token'
const ROTATED_REFRESH_TOKEN = 'rotated-refresh-token'
const USER_CODE = 'ABCD-EFGH'
const VERIFICATION_ORIGIN = 'https://login.example'
const ISSUER = `https://api.workos.com/user_management/${CLIENT_ID}`
const NOW = 2_000_000_000_000
const CANARY = 'secret-canary-must-not-escape'

function authConfig(overrides: Partial<CliAuthConfig> = {}): Readonly<CliAuthConfig> {
  return Object.freeze({
    registryOrigin: 'https://registry.example',
    provider: 'workos',
    clientId: CLIENT_ID,
    issuer: ISSUER,
    authorizationEndpoint: 'https://api.workos.com/user_management/authorize/device',
    tokenEndpoint: 'https://api.workos.com/user_management/authenticate',
    verificationOrigin: VERIFICATION_ORIGIN,
    onboardingUrl: 'https://app.example/auth/onboarding',
    ...overrides,
  } satisfies CliAuthConfig)
}

function challenge(overrides: Partial<DeviceAuthorizationChallenge> = {}): Readonly<DeviceAuthorizationChallenge> {
  return Object.freeze({
    display: Object.freeze({
      userCode: USER_CODE,
      verificationUri: `${VERIFICATION_ORIGIN}/device`,
      verificationUriComplete: `${VERIFICATION_ORIGIN}/device?user_code=${USER_CODE}`,
    }),
    secret: Object.freeze({ deviceCode: DEVICE_CODE }),
    expiresAt: NOW + 300_000,
    intervalSeconds: 5,
    ...overrides,
  } satisfies DeviceAuthorizationChallenge)
}

function deviceResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    device_code: DEVICE_CODE,
    user_code: USER_CODE,
    verification_uri: `${VERIFICATION_ORIGIN}/device`,
    verification_uri_complete: `${VERIFICATION_ORIGIN}/device?user_code=${USER_CODE}`,
    expires_in: 300,
    interval: 5,
    ...overrides,
  }
}

function accessToken(overrides: Record<string, unknown> = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    exp: Math.floor(NOW / 1_000) + 3_600,
    iss: ISSUER,
    client_id: CLIENT_ID,
    sub: 'user_01EXAMPLE',
    sid: 'session_01EXAMPLE',
    auth_time: Math.floor(NOW / 1_000) - 10,
    ...overrides,
  })}.signature`
}

function tokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: accessToken(),
    refresh_token: ROTATED_REFRESH_TOKEN,
    ...overrides,
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function makeFetch(
  handler: (request: Request, init?: RequestInit) => Response | Promise<Response>,
): typeof globalThis.fetch {
  const fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init)
    return handler(request, init)
  }
  fetch.preconnect = globalThis.fetch.preconnect
  return fetch
}

async function form(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text())
}

function waitForAbort(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal
    if (signal === null || signal === undefined) {
      reject(new Error('expected a request signal'))
      return
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function tokenValue(result: Awaited<ReturnType<typeof refreshDeviceTokens>>): Readonly<DeviceTokenPair> {
  if (!result.ok) expect.unreachable()
  return result.value
}

describe('requestDeviceAuthorization', () => {
  test('posts only the public client id and separates display data from the device secret', async () => {
    let observedRequest: Request | undefined
    let observedInit: RequestInit | undefined
    const result = await requestDeviceAuthorization(authConfig(), {
      now: () => NOW,
      fetch: makeFetch((request, init) => {
        observedRequest = request
        observedInit = init
        return jsonResponse(deviceResponse())
      }),
    })

    if (!result.ok) expect.unreachable()
    expect(observedRequest?.url).toBe('https://api.workos.com/user_management/authorize/device')
    expect(observedRequest?.method).toBe('POST')
    expect(observedRequest?.redirect).toBe('error')
    expect(observedInit?.redirect).toBe('error')
    expect(observedInit?.credentials).toBe('omit')
    expect(observedRequest?.headers.get('authorization')).toBeNull()
    expect(observedRequest?.headers.get('cookie')).toBeNull()
    expect(observedRequest?.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    if (observedRequest === undefined) expect.unreachable()
    expect([...(await form(observedRequest)).entries()]).toEqual([['client_id', CLIENT_ID]])
    expect(result.value).toEqual(challenge())
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.display)).toBe(true)
    expect(Object.isFrozen(result.value.secret)).toBe(true)
  })

  test('defaults a missing interval to five seconds and floors a faster positive interval', async () => {
    for (const value of [undefined, 1]) {
      const response = deviceResponse()
      if (value === undefined) delete response.interval
      else response.interval = value
      const result = await requestDeviceAuthorization(authConfig(), {
        now: () => NOW,
        fetch: makeFetch(() => jsonResponse(response)),
      })
      if (!result.ok) expect.unreachable()
      expect(result.value.intervalSeconds).toBe(5)
    }
  })

  test.each([
    ['blank device code', { device_code: '' }],
    ['oversized device code', { device_code: 'x'.repeat(4_097) }],
    ['blank user code', { user_code: '' }],
    ['oversized user code', { user_code: 'x'.repeat(129) }],
    ['zero expiry', { expires_in: 0 }],
    ['oversized expiry', { expires_in: 3_601 }],
    ['fractional expiry', { expires_in: 3.5 }],
    ['zero interval', { interval: 0 }],
    ['oversized interval', { interval: 301 }],
    ['foreign verification origin', { verification_uri: 'https://evil.example/device' }],
    ['normalized dot path', { verification_uri: `${VERIFICATION_ORIGIN}/a/../device` }],
    ['verification query', { verification_uri: `${VERIFICATION_ORIGIN}/device?code=${CANARY}` }],
    [
      'complete URL extra query',
      { verification_uri_complete: `${VERIFICATION_ORIGIN}/device?user_code=${USER_CODE}&x=1` },
    ],
    ['complete URL mismatched code', { verification_uri_complete: `${VERIFICATION_ORIGIN}/device?user_code=OTHER` }],
    [
      'complete URL encoded path',
      { verification_uri_complete: `${VERIFICATION_ORIGIN}/%64evice?user_code=${USER_CODE}` },
    ],
  ])('rejects %s without exposing response data', async (_name, overrides) => {
    const result = await requestDeviceAuthorization(authConfig(), {
      now: () => NOW,
      fetch: makeFetch(() => jsonResponse(deviceResponse({ ...overrides, error_description: CANARY }))),
    })
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_DEVICE_RESPONSE' } })
    expect(JSON.stringify(result)).not.toContain(CANARY)
    expect(JSON.stringify(result)).not.toContain(DEVICE_CODE)
  })

  test('does not follow redirects or propagate an upstream error body', async () => {
    const result = await requestDeviceAuthorization(authConfig(), {
      fetch: makeFetch(
        () =>
          new Response(JSON.stringify({ error_description: CANARY }), {
            status: 302,
            headers: { location: `https://evil.example/?secret=${CANARY}` },
          }),
      ),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'DEVICE_AUTH_UNAVAILABLE', reason: 'unexpected-response', status: 302 },
    })
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('bounds a hung authorization request with a sanitized timeout', async () => {
    const result = await requestDeviceAuthorization(authConfig(), {
      requestTimeoutMs: 1,
      fetch: makeFetch((_request, init) => waitForAbort(init)),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'DEVICE_AUTH_UNAVAILABLE', reason: 'timeout' },
    })
  })

  test('distinguishes cancellation before and after dispatch', async () => {
    const before = new AbortController()
    before.abort()
    let calls = 0
    const predispatch = await requestDeviceAuthorization(authConfig(), {
      signal: before.signal,
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(deviceResponse())
      }),
    })
    expect(predispatch).toEqual({ ok: false, error: { code: 'CANCELLED', attempted: false } })
    expect(calls).toBe(0)

    const during = new AbortController()
    const postdispatch = await requestDeviceAuthorization(authConfig(), {
      signal: during.signal,
      fetch: makeFetch(() => {
        calls++
        during.abort()
        throw new DOMException('aborted', 'AbortError')
      }),
    })
    expect(postdispatch).toEqual({ ok: false, error: { code: 'CANCELLED', attempted: true } })
    expect(calls).toBe(1)
  })

  test.each([
    ['authorization endpoint', { authorizationEndpoint: 'https://evil.example/authorize' }],
    ['token endpoint', { tokenEndpoint: 'https://evil.example/token' }],
    ['issuer', { issuer: 'https://evil.example' }],
    ['verification path', { verificationOrigin: `${VERIFICATION_ORIGIN}/device` }],
    ['verification HTTP', { verificationOrigin: 'http://login.example' }],
  ])('rejects a forged config %s before dispatch', async (_name, overrides) => {
    let calls = 0
    const result = await requestDeviceAuthorization(authConfig(overrides), {
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(deviceResponse())
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_AUTH_CONFIG' } })
    expect(calls).toBe(0)
  })
})

describe('pollDeviceAuthorization', () => {
  test('waits before every request, sends the exact device grant, and returns explicitly untrusted metadata', async () => {
    let clock = NOW
    const events: string[] = []
    const waits: number[] = []
    const requests: Request[] = []
    const requestInits: Array<RequestInit | undefined> = []
    let call = 0
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      sleep: async (milliseconds) => {
        events.push(`sleep:${milliseconds}`)
        waits.push(milliseconds)
        clock += milliseconds
      },
      fetch: makeFetch((request, init) => {
        events.push('fetch')
        requests.push(request)
        requestInits.push(init)
        call++
        return call === 1 ? jsonResponse({ error: 'authorization_pending' }, 400) : jsonResponse(tokenResponse())
      }),
    })

    if (!result.ok) expect.unreachable()
    expect(events).toEqual(['sleep:5000', 'fetch', 'sleep:5000', 'fetch'])
    expect(waits).toEqual([5_000, 5_000])
    expect(requests).toHaveLength(2)
    for (const [index, request] of requests.entries()) {
      expect(request.url).toBe('https://api.workos.com/user_management/authenticate')
      expect(request.redirect).toBe('error')
      expect(requestInits[index]?.credentials).toBe('omit')
      expect(requestInits[index]?.redirect).toBe('error')
      expect(request.headers.get('authorization')).toBeNull()
      expect(request.headers.get('cookie')).toBeNull()
      expect([...(await form(request)).entries()]).toEqual([
        ['grant_type', 'urn:ietf:params:oauth:grant-type:device_code'],
        ['device_code', DEVICE_CODE],
        ['client_id', CLIENT_ID],
      ])
    }
    expect(result.value.accessToken).toBe(accessToken())
    expect(result.value.refreshToken).toBe(ROTATED_REFRESH_TOKEN)
    expect(result.value.untrustedMetadata).toEqual({
      trust: 'untrusted',
      expiresAt: NOW + 3_600_000,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      subject: 'user_01EXAMPLE',
      sessionId: 'session_01EXAMPLE',
      authTime: Math.floor(NOW / 1_000) - 10,
    })
  })

  test('adds at least five seconds after slow_down', async () => {
    let clock = NOW
    const waits: number[] = []
    let call = 0
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        clock += milliseconds
      },
      fetch: makeFetch(() => {
        call++
        return call === 1 ? jsonResponse({ error: 'slow_down' }, 400) : jsonResponse(tokenResponse())
      }),
    })
    expect(result.ok).toBe(true)
    expect(waits).toEqual([5_000, 10_000])
  })

  test.each([
    ['access_denied', 'AUTHORIZATION_DENIED'],
    ['expired_token', 'AUTHORIZATION_EXPIRED'],
  ] satisfies ReadonlyArray<
    readonly [string, 'AUTHORIZATION_DENIED' | 'AUTHORIZATION_EXPIRED']
  >)('stops on terminal RFC outcome %s', async (oauthError, expectedCode) => {
    let clock = NOW
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds
      },
      fetch: makeFetch(() => jsonResponse({ error: oauthError, error_description: CANARY }, 400)),
    })
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe(expectedCode)
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('expires at the local deadline without sending a request', async () => {
    let clock = NOW
    let calls = 0
    const result = await pollDeviceAuthorization(authConfig(), challenge({ expiresAt: NOW + 4_000 }), {
      now: () => clock,
      sleep: async (milliseconds) => {
        expect(milliseconds).toBe(4_000)
        clock += milliseconds
      },
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(tokenResponse())
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'AUTHORIZATION_EXPIRED' } })
    expect(calls).toBe(0)
  })

  test('stops before the initial wait when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    let sleeps = 0
    let calls = 0
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => NOW,
      signal: controller.signal,
      sleep: async () => {
        sleeps++
      },
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(tokenResponse())
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'CANCELLED', attempted: false } })
    expect(sleeps).toBe(0)
    expect(calls).toBe(0)
  })

  test('reports cancellation after a poll dispatch without another request', async () => {
    let clock = NOW
    let calls = 0
    const controller = new AbortController()
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      signal: controller.signal,
      sleep: async (milliseconds) => {
        clock += milliseconds
      },
      fetch: makeFetch(() => {
        calls++
        controller.abort()
        throw new DOMException('aborted', 'AbortError')
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'CANCELLED', attempted: true } })
    expect(calls).toBe(1)
  })

  test('bounds repeated 429/5xx outcomes and backs off without a busy loop', async () => {
    let clock = NOW
    const waits: number[] = []
    let calls = 0
    const statuses = [429, 502, 503]
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      sleep: async (milliseconds) => {
        waits.push(milliseconds)
        clock += milliseconds
      },
      fetch: makeFetch(() => {
        const status = statuses[calls] ?? 503
        calls++
        return jsonResponse({ error: CANARY, error_description: CANARY }, status)
      }),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'POLLING_UNAVAILABLE', reason: 'server', status: 503 },
    })
    expect(calls).toBe(3)
    expect(waits).toEqual([5_000, 10_000, 15_000])
    expect(JSON.stringify(result)).not.toContain(CANARY)
    expect(JSON.stringify(result)).not.toContain(DEVICE_CODE)
  })

  test('bounds hung poll requests and classifies their deadline as transient', async () => {
    let clock = NOW
    let calls = 0
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      requestTimeoutMs: 1,
      sleep: async (milliseconds) => {
        clock += milliseconds
      },
      fetch: makeFetch((_request, init) => {
        calls++
        return waitForAbort(init)
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'POLLING_UNAVAILABLE', reason: 'timeout' } })
    expect(calls).toBe(3)
  })

  test.each([
    ['malformed JWT', { access_token: 'not-a-jwt' }],
    ['expired JWT', { access_token: accessToken({ exp: Math.floor(NOW / 1_000) }) }],
    ['maximum-safe integer expiry', { access_token: accessToken({ exp: Number.MAX_SAFE_INTEGER }) }],
    [
      'millisecond conversion overflow',
      { access_token: accessToken({ exp: Math.floor(Number.MAX_SAFE_INTEGER / 1_000) + 1 }) },
    ],
    ['maximum-safe integer auth time', { access_token: accessToken({ auth_time: Number.MAX_SAFE_INTEGER }) }],
    ['auth time beyond clock skew', { access_token: accessToken({ auth_time: NOW / 1_000 + 66 }) }],
    ['wrong issuer', { access_token: accessToken({ iss: 'https://evil.example' }) }],
    ['wrong client', { access_token: accessToken({ client_id: 'client_other' }) }],
    ['missing subject', { access_token: accessToken({ sub: undefined }) }],
    ['missing session', { access_token: accessToken({ sid: undefined }) }],
    ['missing auth time', { access_token: accessToken({ auth_time: undefined }) }],
    ['blank refresh token', { refresh_token: '' }],
  ])('rejects %s and exposes no token', async (_name, overrides) => {
    let clock = NOW
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds
      },
      fetch: makeFetch(() => jsonResponse(tokenResponse(overrides))),
    })
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_TOKEN_RESPONSE' } })
    expect(JSON.stringify(result)).not.toContain(ROTATED_REFRESH_TOKEN)
  })

  test('accepts a precise expiry conversion and exactly one minute of auth time clock skew', async () => {
    const maxSafeUnixSeconds = Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      now: () => NOW,
      fetch: makeFetch(() =>
        jsonResponse(
          tokenResponse({
            access_token: accessToken({ exp: maxSafeUnixSeconds, auth_time: NOW / 1_000 + 60 }),
          }),
        ),
      ),
    })
    const metadata = tokenValue(result).untrustedMetadata
    expect(metadata.expiresAt).toBe(maxSafeUnixSeconds * 1_000)
    expect(Number.isSafeInteger(metadata.expiresAt)).toBe(true)
    expect(metadata.authTime).toBe(NOW / 1_000 + 60)
    expect(metadata.trust).toBe('untrusted')
  })

  test('rejects auth time one millisecond beyond the clock-skew boundary', async () => {
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      now: () => NOW - 1,
      fetch: makeFetch(() =>
        jsonResponse(tokenResponse({ access_token: accessToken({ auth_time: NOW / 1_000 + 60 }) })),
      ),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'REFRESH_UNCERTAIN', reason: 'malformed-success', attempted: true },
    })
  })

  test.each([
    ['foreign display URI', { display: { ...challenge().display, verificationUri: 'https://evil.example/device' } }],
    [
      'normalized display path',
      { display: { ...challenge().display, verificationUri: `${VERIFICATION_ORIGIN}/a/../device` } },
    ],
    [
      'foreign complete URI',
      { display: { ...challenge().display, verificationUriComplete: 'https://evil.example/device' } },
    ],
    ['too-fast interval', { intervalSeconds: 4 }],
    ['unbounded interval', { intervalSeconds: 301 }],
    ['future expiry', { expiresAt: NOW + 3_601_000 }],
  ])('rejects hostile challenge %s before sleeping or dispatching', async (_name, overrides) => {
    let activity = 0
    const result = await pollDeviceAuthorization(authConfig(), challenge(overrides), {
      now: () => NOW,
      sleep: async () => {
        activity++
      },
      fetch: makeFetch(() => {
        activity++
        return jsonResponse(tokenResponse())
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'INVALID_DEVICE_CHALLENGE' } })
    expect(activity).toBe(0)
  })
})

describe('refreshDeviceTokens', () => {
  test('makes exactly one public refresh grant request and returns the rotated pair as untrusted', async () => {
    let calls = 0
    let observedRequest: Request | undefined
    let observedInit: RequestInit | undefined
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      now: () => NOW,
      fetch: makeFetch((request, init) => {
        calls++
        observedRequest = request
        observedInit = init
        return jsonResponse(tokenResponse())
      }),
    })

    expect(calls).toBe(1)
    expect(observedRequest?.url).toBe('https://api.workos.com/user_management/authenticate')
    expect(observedRequest?.redirect).toBe('error')
    expect(observedInit?.redirect).toBe('error')
    expect(observedInit?.credentials).toBe('omit')
    expect(observedRequest?.headers.get('authorization')).toBeNull()
    expect(observedRequest?.headers.get('cookie')).toBeNull()
    if (observedRequest === undefined) expect.unreachable()
    expect([...(await form(observedRequest)).entries()]).toEqual([
      ['grant_type', 'refresh_token'],
      ['refresh_token', REFRESH_TOKEN],
      ['client_id', CLIENT_ID],
    ])
    const value = tokenValue(result)
    expect(value.refreshToken).toBe(ROTATED_REFRESH_TOKEN)
    expect(value.untrustedMetadata.trust).toBe('untrusted')
  })

  test('rejects an invalid refresh token before dispatch', async () => {
    let calls = 0
    for (const refreshToken of ['', ' token', 'x'.repeat(16_385)]) {
      const result = await refreshDeviceTokens(authConfig(), refreshToken, {
        fetch: makeFetch(() => {
          calls++
          return jsonResponse(tokenResponse())
        }),
      })
      expect(result).toEqual({ ok: false, error: { code: 'INVALID_REFRESH_TOKEN' } })
    }
    expect(calls).toBe(0)
  })

  test('distinguishes safe pre-dispatch cancellation from an attempted exchange', async () => {
    const before = new AbortController()
    before.abort()
    let calls = 0
    const predispatch = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      signal: before.signal,
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(tokenResponse())
      }),
    })
    expect(predispatch).toEqual({ ok: false, error: { code: 'CANCELLED', attempted: false } })
    expect(calls).toBe(0)

    const during = new AbortController()
    const attempted = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      signal: during.signal,
      fetch: makeFetch(() => {
        calls++
        during.abort()
        throw new DOMException('aborted', 'AbortError')
      }),
    })
    expect(attempted).toEqual({
      ok: false,
      error: { code: 'REFRESH_TRANSIENT', reason: 'cancelled', attempted: true },
    })
    expect(calls).toBe(1)
  })

  test.each([
    ['timeout', new DOMException(CANARY, 'TimeoutError'), 'timeout'],
    ['network', new Error(CANARY), 'network'],
  ] satisfies ReadonlyArray<
    readonly [string, Error, 'timeout' | 'network']
  >)('classifies one %s failure as transient without leaking it', async (_name, thrown, reason) => {
    let calls = 0
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      fetch: makeFetch(() => {
        calls++
        throw thrown
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'REFRESH_TRANSIENT', reason, attempted: true } })
    expect(calls).toBe(1)
    expect(JSON.stringify(result)).not.toContain(CANARY)
    expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN)
  })

  test('makes one attempted exchange when its internal request deadline expires', async () => {
    let calls = 0
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      requestTimeoutMs: 1,
      fetch: makeFetch((_request, init) => {
        calls++
        return waitForAbort(init)
      }),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'REFRESH_TRANSIENT', reason: 'timeout', attempted: true },
    })
    expect(calls).toBe(1)
  })

  test.each([
    [408, 'timeout'],
    [429, 'rate-limited'],
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
    [504, 'server'],
  ] satisfies ReadonlyArray<
    readonly [number, 'timeout' | 'rate-limited' | 'server']
  >)('classifies HTTP %i as one transient exchange', async (status, reason) => {
    let calls = 0
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      fetch: makeFetch(() => {
        calls++
        return jsonResponse({ error: CANARY, error_description: CANARY }, status)
      }),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'REFRESH_TRANSIENT', reason, attempted: true, status },
    })
    expect(calls).toBe(1)
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('treats only HTTP 400 invalid_grant as terminal', async () => {
    const terminal = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      fetch: makeFetch(() => jsonResponse({ error: 'invalid_grant', error_description: CANARY }, 400)),
    })
    expect(terminal).toEqual({ ok: false, error: { code: 'REAUTHENTICATION_REQUIRED' } })
    expect(JSON.stringify(terminal)).not.toContain(CANARY)

    for (const [status, error] of [
      [401, 'invalid_grant'],
      [400, 'invalid_request'],
    ] as const) {
      const uncertain = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
        fetch: makeFetch(() => jsonResponse({ error, error_description: CANARY }, status)),
      })
      expect(uncertain).toEqual({
        ok: false,
        error: { code: 'REFRESH_UNCERTAIN', reason: 'unexpected-response', attempted: true, status },
      })
      expect(JSON.stringify(uncertain)).not.toContain(CANARY)
    }
  })

  test.each([
    ['malformed success', tokenResponse({ access_token: 'not-a-jwt' })],
    ['issuer mismatch', tokenResponse({ access_token: accessToken({ iss: 'https://evil.example' }) })],
    ['client mismatch', tokenResponse({ access_token: accessToken({ client_id: 'client_other' }) })],
    ['secret body', { error_description: CANARY, access_token: CANARY, refresh_token: CANARY }],
  ])('treats %s as uncertain and exposes no unvalidated token', async (_name, body) => {
    let calls = 0
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      now: () => NOW,
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(body)
      }),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'REFRESH_UNCERTAIN', reason: 'malformed-success', attempted: true },
    })
    expect(calls).toBe(1)
    expect(JSON.stringify(result)).not.toContain(CANARY)
    expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN)
  })

  test('does not follow a refresh redirect', async () => {
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      fetch: makeFetch(
        () => new Response(null, { status: 302, headers: { location: `https://evil.example/?token=${CANARY}` } }),
      ),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'REFRESH_UNCERTAIN', reason: 'unexpected-response', attempted: true, status: 302 },
    })
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })
})

describe('bounded device response transport regressions', () => {
  test.each([
    ['network', new TypeError(CANARY)],
    ['timeout', new DOMException(CANARY, 'TimeoutError')],
  ] satisfies ReadonlyArray<
    readonly ['network' | 'timeout', Error]
  >)('post-header %s failure is transient and never replayed locally', async (reason, error) => {
    let calls = 0
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      fetch: makeFetch(() => {
        calls++
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(error)
            },
          }),
        )
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'REFRESH_TRANSIENT', reason, attempted: true } })
    expect(calls).toBe(1)
    expect(JSON.stringify(result)).not.toContain(CANARY)
  })

  test('request and polling classify failed bodies as transport failures', async () => {
    const fetch = makeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new TypeError(CANARY))
            },
          }),
        ),
    )
    expect(await requestDeviceAuthorization(authConfig(), { fetch })).toEqual({
      ok: false,
      error: { code: 'DEVICE_AUTH_UNAVAILABLE', reason: 'network' },
    })
    let clock = NOW
    let calls = 0
    const result = await pollDeviceAuthorization(authConfig(), challenge(), {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      fetch: makeFetch((request, init) => {
        calls++
        return fetch(request, init)
      }),
    })
    expect(result).toEqual({ ok: false, error: { code: 'POLLING_UNAVAILABLE', reason: 'network' } })
    expect(calls).toBe(3)
  })

  test.each([undefined, '1'])('counts actual UTF-8 bytes with content-length %p', async (length) => {
    const text = JSON.stringify(tokenResponse({ padding: 'é'.repeat(40_000) }))
    expect(text.length).toBeLessThan(65_536)
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(65_536)
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      now: () => NOW,
      fetch: makeFetch(() => new Response(text, { headers: length === undefined ? {} : { 'content-length': length } })),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'REFRESH_UNCERTAIN', reason: 'malformed-success', attempted: true },
    })
  })

  test('cancels an oversized multi-chunk response before draining it', async () => {
    let pulls = 0
    let cancelled = false
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      fetch: makeFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                pulls++
                if (pulls <= 32) controller.enqueue(new Uint8Array(8192).fill(32))
                else controller.close()
              },
              cancel() {
                cancelled = true
              },
            }),
          ),
      ),
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'REFRESH_UNCERTAIN', reason: 'malformed-success', attempted: true },
    })
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(32)
  })

  test('accepts exactly 65536 actual bytes despite an oversized content-length claim', async () => {
    const text = JSON.stringify(tokenResponse())
    const bytes = new TextEncoder().encode(text)
    const padded = text + ' '.repeat(65_536 - bytes.byteLength)
    const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
      now: () => NOW,
      fetch: makeFetch(() => new Response(padded, { headers: { 'content-length': '999999' } })),
    })
    expect(tokenValue(result).refreshToken).toBe(ROTATED_REFRESH_TOKEN)
  })

  test.each([
    'request',
    'poll',
    'refresh',
  ])('%s caller abort during a stalled body cancels the reader', async (kind) => {
    const controller = new AbortController()
    let cancelled = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const abortTimer = setTimeout(() => controller.abort(), 10)
    const fetch = makeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              closeTimer = setTimeout(() => stream.close(), 80)
            },
            cancel() {
              cancelled = true
              clearTimeout(closeTimer)
            },
          }),
        ),
    )
    try {
      let clock = NOW
      const dependencies = {
        fetch,
        signal: controller.signal,
        now: () => clock,
        sleep: async (ms: number) => {
          clock += ms
        },
      }
      const result =
        kind === 'request'
          ? await requestDeviceAuthorization(authConfig(), dependencies)
          : kind === 'poll'
            ? await pollDeviceAuthorization(authConfig(), challenge(), dependencies)
            : await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, dependencies)
      if (kind === 'refresh') {
        expect(result).toEqual({
          ok: false,
          error: { code: 'REFRESH_TRANSIENT', reason: 'cancelled', attempted: true },
        })
      } else {
        expect(result).toEqual({ ok: false, error: { code: 'CANCELLED', attempted: true } })
      }
      expect(cancelled).toBe(true)
    } finally {
      clearTimeout(abortTimer)
      clearTimeout(closeTimer)
    }
  })

  test('the original deadline includes header latency and cancels a stalled body', async () => {
    let completed = false
    let cancelled = false
    let bodyTimer: ReturnType<typeof setTimeout> | undefined
    let calls = 0
    try {
      const result = await refreshDeviceTokens(authConfig(), REFRESH_TOKEN, {
        now: () => NOW,
        requestTimeoutMs: 100,
        fetch: makeFetch(async () => {
          calls++
          await new Promise<void>((resolve) => setTimeout(resolve, 60))
          return new Response(
            new ReadableStream<Uint8Array>({
              start(stream) {
                bodyTimer = setTimeout(() => {
                  completed = true
                  stream.enqueue(new TextEncoder().encode(JSON.stringify(tokenResponse())))
                  stream.close()
                }, 80)
              },
              cancel() {
                cancelled = true
                clearTimeout(bodyTimer)
              },
            }),
          )
        }),
      })
      expect(result).toEqual({ ok: false, error: { code: 'REFRESH_TRANSIENT', reason: 'timeout', attempted: true } })
      expect(calls).toBe(1)
      expect(cancelled).toBe(true)
      expect(completed).toBe(false)
    } finally {
      clearTimeout(bodyTimer)
    }
  })

  test.each([920_000, 900_000])('slow_down respects 300->305->310 and expiry at %i ms', async (lifetime) => {
    let clock = NOW
    const waits: number[] = []
    let calls = 0
    const result = await pollDeviceAuthorization(
      authConfig(),
      challenge({ intervalSeconds: 300, expiresAt: NOW + lifetime }),
      {
        now: () => clock,
        sleep: async (ms) => {
          waits.push(ms)
          clock += ms
        },
        fetch: makeFetch(() => {
          calls++
          return jsonResponse({ error: calls <= 2 ? 'slow_down' : 'access_denied' }, 400)
        }),
      },
    )
    expect(result).toEqual({
      ok: false,
      error: { code: lifetime === 920_000 ? 'AUTHORIZATION_DENIED' : 'AUTHORIZATION_EXPIRED' },
    })
    expect(waits).toEqual(lifetime === 920_000 ? [300_000, 305_000, 310_000] : [300_000, 305_000, 295_000])
    expect(calls).toBe(lifetime === 920_000 ? 3 : 2)
  })
})
