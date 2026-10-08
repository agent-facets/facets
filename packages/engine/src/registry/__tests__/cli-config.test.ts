import { describe, expect, test } from 'bun:test'
import {
  type CliConfigFailure,
  type CliConfigResult,
  fetchCliAuthConfig,
  validateRegistryOrigin,
} from '../cli-config.ts'

const REGISTRY_ORIGIN = 'https://registry.example'
const CLIENT_ID = 'client_01HZXYPJYQ8V7Z9M4G3K2N1P0R'
const CANARY = 'secret-canary-must-not-escape'
const INVALID_RAW_REGISTRY_URLS = [
  'https://registry.example/.',
  'https://registry.example/a/..',
  'https://registry.example/%2e',
  'https://registry.example/%2e%2e',
  'https://registry.example//',
  'https://registry.example\\config',
  'https://registry.example?',
  'https://registry.example#',
]
const INVALID_RAW_ONBOARDING_URLS = [
  'https://app.example/auth/./onboarding',
  'https://app.example/auth/%2e/onboarding',
  'https://app.example/auth/a/../onboarding',
  'https://app.example/auth/%2e%2e/auth/onboarding',
  'https://app.example/auth//onboarding',
  'https://app.example/auth\\onboarding',
  'https://app.example\\auth\\onboarding',
  'https://app.example/auth/onboarding?',
  'https://app.example/auth/onboarding#',
]

function enabledConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    provider: 'workos',
    client_id: CLIENT_ID,
    issuer: `https://api.workos.com/user_management/${CLIENT_ID}`,
    authorization_endpoint: 'https://api.workos.com/user_management/authorize/device',
    token_endpoint: 'https://api.workos.com/user_management/authenticate',
    verification_origin: 'https://login.example',
    onboarding_url: 'https://app.example/auth/onboarding',
    ...overrides,
  }
}

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
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

function expectFailure<T>(result: CliConfigResult<T>, expected: CliConfigFailure): void {
  if (result.ok) expect.unreachable()
  expect(result.error).toEqual(expected)
}

describe('validateRegistryOrigin', () => {
  test.each([
    ['https://registry.example', 'https://registry.example'],
    ['https://REGISTRY.example/', 'https://registry.example'],
    ['https://registry.example:8443', 'https://registry.example:8443'],
    ['https://[2001:db8::1]:8443/', 'https://[2001:db8::1]:8443'],
  ])('accepts and normalizes a bare HTTPS origin: %s', (raw, expected) => {
    expect(validateRegistryOrigin(raw)).toEqual({ ok: true, value: expected })
  })

  test.each([
    ...INVALID_RAW_REGISTRY_URLS,
    ' https://registry.example',
    'https://registry.example\n',
    'https://user@registry.example',
    'https://registry.example/path',
    'https://registry.example?next=evil',
    'https://registry.example#fragment',
    'http://registry.example',
    'ftp://registry.example',
    'registry.example',
  ])('rejects a non-bare or untrusted origin: %s', (raw) => {
    expectFailure(validateRegistryOrigin(raw), { code: 'INVALID_REGISTRY_ORIGIN' })
  })

  test.each([
    ['http://localhost:3100', 'http://localhost:3100'],
    ['http://127.0.0.1:3100/', 'http://127.0.0.1:3100'],
    ['http://[::1]:3100', 'http://[::1]:3100'],
  ])('allows true HTTP loopback only with the explicit test option: %s', (raw, expected) => {
    expectFailure(validateRegistryOrigin(raw), { code: 'INVALID_REGISTRY_ORIGIN' })
    expect(validateRegistryOrigin(raw, true)).toEqual({ ok: true, value: expected })
  })

  test.each([
    'http://localhost.evil.example:3100',
    'http://127.0.0.1.evil.example:3100',
    'http://127.0.0.2:3100',
    'http://127.1:3100',
    'http://2130706433:3100',
    'http://0177.0.0.1:3100',
    'http://[::2]:3100',
  ])('rejects loopback lookalikes even in test mode: %s', (raw) => {
    expectFailure(validateRegistryOrigin(raw, true), { code: 'INVALID_REGISTRY_ORIGIN' })
  })
})

describe('fetchCliAuthConfig request binding', () => {
  test.each(INVALID_RAW_REGISTRY_URLS)('rejects %s before making any request', async (registryUrl) => {
    let calls = 0
    const result = await fetchCliAuthConfig({
      registryUrl,
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(enabledConfig())
      }),
    })
    expect(calls).toBe(0)
    expectFailure(result, { code: 'INVALID_REGISTRY_ORIGIN' })
  })

  test('uses the selected origin once and sends an anonymous no-cookie non-redirecting request', async () => {
    let observed: Request | undefined
    let observedInit: RequestInit | undefined
    const result = await fetchCliAuthConfig({
      registryUrl: `${REGISTRY_ORIGIN}/`,
      fetch: makeFetch((request, init) => {
        observed = request
        observedInit = init
        return jsonResponse(enabledConfig())
      }),
      timeoutMs: 100,
    })

    if (!result.ok) expect.unreachable()
    expect(observed?.url).toBe(`${REGISTRY_ORIGIN}/v0/auth/cli/config`)
    expect(observed?.redirect).toBe('error')
    expect(observedInit?.credentials).toBe('omit')
    expect(observedInit?.redirect).toBe('error')
    expect(observed?.headers.get('authorization')).toBeNull()
    expect(observed?.headers.get('cookie')).toBeNull()
    expect(result.value.registryOrigin).toBe(REGISTRY_ORIGIN)
    expect(result.value.clientId).toBe(CLIENT_ID)
    expect(result.value.authorizationEndpoint).toBe('https://api.workos.com/user_management/authorize/device')
    expect(result.value.tokenEndpoint).toBe('https://api.workos.com/user_management/authenticate')
    expect(Object.isFrozen(result.value)).toBe(true)
  })

  test('retains the originally selected registry when FACET_REGISTRY_URL mutates during the fetch', async () => {
    const original = process.env.FACET_REGISTRY_URL
    process.env.FACET_REGISTRY_URL = 'https://first-registry.example'
    let requestUrl = ''
    try {
      const result = await fetchCliAuthConfig({
        fetch: makeFetch((request) => {
          requestUrl = request.url
          process.env.FACET_REGISTRY_URL = 'https://second-registry.example'
          return jsonResponse(enabledConfig())
        }),
      })
      if (!result.ok) expect.unreachable()
      expect(requestUrl).toBe('https://first-registry.example/v0/auth/cli/config')
      expect(result.value.registryOrigin).toBe('https://first-registry.example')
    } finally {
      if (original === undefined) delete process.env.FACET_REGISTRY_URL
      else process.env.FACET_REGISTRY_URL = original
    }
  })

  test('does not follow a hostile config redirect', async () => {
    let calls = 0
    const result = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      fetch: makeFetch((request) => {
        calls++
        expect(request.redirect).toBe('error')
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/config' } })
      }),
    })
    expect(calls).toBe(1)
    expectFailure(result, { code: 'CLI_CONFIG_UNAVAILABLE', status: 302 })
  })
})

describe('fetchCliAuthConfig response validation', () => {
  test.each(['cognito', 'workos'])('returns a structured disabled result for provider %s', async (provider) => {
    const result = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      fetch: makeFetch(() => jsonResponse({ enabled: false, provider })),
    })
    expectFailure(result, { code: 'CLI_AUTH_DISABLED', provider })
  })

  test.each([
    ['blank client id', { client_id: '' }],
    ['client id whitespace', { client_id: ` ${CLIENT_ID}` }],
    ['issuer mismatch', { issuer: 'https://api.workos.com/user_management/client_other' }],
    ['hostile authorization endpoint', { authorization_endpoint: 'https://evil.example/authorize/device' }],
    ['hostile token endpoint', { token_endpoint: 'https://evil.example/authenticate' }],
    ['verification origin over HTTP', { verification_origin: 'http://login.example' }],
    ['verification origin with path', { verification_origin: 'https://login.example/device' }],
    ['verification origin with credentials', { verification_origin: 'https://user@login.example' }],
    ['onboarding query', { onboarding_url: 'https://app.example/auth/onboarding?token=secret' }],
    ['onboarding fragment', { onboarding_url: 'https://app.example/auth/onboarding#secret' }],
    ['onboarding credentials', { onboarding_url: 'https://user@app.example/auth/onboarding' }],
    ['onboarding wrong path', { onboarding_url: 'https://app.example/auth/onboard' }],
    ['onboarding remote HTTP', { onboarding_url: 'http://app.example/auth/onboarding' }],
    ['unreviewed extra field', { extra_endpoint: 'https://evil.example' }],
  ])('rejects %s', async (_name, overrides) => {
    const result = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      fetch: makeFetch(() => jsonResponse(enabledConfig(overrides))),
    })
    expectFailure(result, { code: 'INVALID_CLI_CONFIG' })
  })

  test.each(
    INVALID_RAW_ONBOARDING_URLS,
  )('rejects a non-exact onboarding URL without propagating it: %s', async (onboardingUrl) => {
    let calls = 0
    const result = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(enabledConfig({ onboarding_url: onboardingUrl }))
      }),
    })
    expect(calls).toBe(1)
    expectFailure(result, { code: 'INVALID_CLI_CONFIG' })
    expect(JSON.stringify(result)).not.toContain(onboardingUrl)
  })

  test.each([
    null,
    [],
    'enabled',
    { enabled: true, provider: 'cognito' },
    { enabled: false, provider: 'workos', client_id: CLIENT_ID },
  ])('rejects a malformed success payload without trusting generated types', async (body) => {
    const result = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      fetch: makeFetch(() => jsonResponse(body)),
    })
    expectFailure(result, { code: 'INVALID_CLI_CONFIG' })
  })

  test('allows an HTTP loopback onboarding URL only in explicit local-test mode', async () => {
    const body = enabledConfig({ onboarding_url: 'http://127.0.0.1:3000/auth/onboarding' })
    const denied = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      fetch: makeFetch(() => jsonResponse(body)),
    })
    expectFailure(denied, { code: 'INVALID_CLI_CONFIG' })

    const allowed = await fetchCliAuthConfig({
      registryUrl: 'http://127.0.0.1:4000',
      allowHttpLoopback: true,
      fetch: makeFetch(() => jsonResponse(body)),
    })
    expect(allowed.ok).toBe(true)
  })

  test.each([
    'http://localhost.evil.example/auth/onboarding',
    'http://2130706433/auth/onboarding',
  ])('rejects an HTTP loopback lookalike onboarding host in local-test mode: %s', async (onboardingUrl) => {
    const result = await fetchCliAuthConfig({
      registryUrl: 'http://localhost:4000',
      allowHttpLoopback: true,
      fetch: makeFetch(() => jsonResponse(enabledConfig({ onboarding_url: onboardingUrl }))),
    })
    expectFailure(result, { code: 'INVALID_CLI_CONFIG' })
  })

  test('does not expose hostile response data or thrown text in failure values', async () => {
    const rejected = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      fetch: makeFetch(() => jsonResponse({ error: CANARY }, 503)),
    })
    expectFailure(rejected, { code: 'CLI_CONFIG_UNAVAILABLE', status: 503 })
    expect(JSON.stringify(rejected)).not.toContain(CANARY)

    const thrown = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      timeoutMs: 1,
      fetch: makeFetch(() => {
        throw new Error(CANARY)
      }),
    })
    expectFailure(thrown, { code: 'CLI_CONFIG_UNAVAILABLE' })
    expect(JSON.stringify(thrown)).not.toContain(CANARY)
  })
})

describe('config cancellation and original body deadline regressions', () => {
  test('pre-aborted caller signal performs zero fetches', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const result = await fetchCliAuthConfig({
      registryUrl: REGISTRY_ORIGIN,
      signal: controller.signal,
      fetch: makeFetch(() => {
        calls++
        return jsonResponse(enabledConfig())
      }),
    })
    expectFailure(result, { code: 'CLI_CONFIG_UNAVAILABLE' })
    expect(calls).toBe(0)
  })

  test('caller signal reaches the actual fetch and interrupts a stalled config body', async () => {
    const controller = new AbortController()
    let observedSignal: AbortSignal | null | undefined
    let cancelled = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const abortTimer = setTimeout(() => controller.abort(), 10)
    try {
      const result = await fetchCliAuthConfig({
        registryUrl: REGISTRY_ORIGIN,
        signal: controller.signal,
        fetch: makeFetch((_request, init) => {
          observedSignal = init?.signal
          return new Response(
            new ReadableStream<Uint8Array>({
              start(stream) {
                closeTimer = setTimeout(() => {
                  stream.enqueue(new TextEncoder().encode(JSON.stringify(enabledConfig())))
                  stream.close()
                }, 80)
              },
              cancel() {
                cancelled = true
                clearTimeout(closeTimer)
              },
            }),
          )
        }),
      })
      expectFailure(result, { code: 'CLI_CONFIG_UNAVAILABLE' })
      expect(observedSignal?.aborted).toBe(true)
      expect(cancelled).toBe(true)
    } finally {
      clearTimeout(abortTimer)
      clearTimeout(closeTimer)
    }
  })

  test('config body remains under the original timeout after delayed headers', async () => {
    let cancelled = false
    let completed = false
    let bodyTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await fetchCliAuthConfig({
        registryUrl: REGISTRY_ORIGIN,
        timeoutMs: 100,
        fetch: makeFetch(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 60))
          return new Response(
            new ReadableStream<Uint8Array>({
              start(stream) {
                bodyTimer = setTimeout(() => {
                  completed = true
                  stream.enqueue(new TextEncoder().encode(JSON.stringify(enabledConfig())))
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
      expectFailure(result, { code: 'CLI_CONFIG_UNAVAILABLE' })
      expect(cancelled).toBe(true)
      expect(completed).toBe(false)
    } finally {
      clearTimeout(bodyTimer)
    }
  })
})
