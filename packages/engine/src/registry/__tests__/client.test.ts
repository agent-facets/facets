/**
 * Integrated tests for the typed registry client.
 *
 * These test the client end-to-end against a stub `fetch` — the
 * full middleware stack (timeout + retry) wired up via
 * `createRegistryClient()`. They are the migration target for the
 * old `packages/cli/src/util/__tests__/registry-client.test.ts`
 * suite — every behavior covered there is covered here, plus the
 * D11 corrections.
 */

import { describe, expect, test } from 'bun:test'
import { createRegistryClient, translateThrownError } from '../client.ts'
import { resolveArchiveUrl } from '../download.ts'
import { apiError } from '../fixtures.ts'

const BASE_URL = 'https://api.test/v0'

/**
 * Wrap a stub function so it satisfies Bun's `typeof fetch` (which
 * includes `preconnect`).
 */
function asFetch(
  fn: (input: Request | string | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return Object.assign(fn, { preconnect() {} })
}

function healthResponse(): Response {
  return new Response(JSON.stringify({ status: 'ok', version: '0.0.0' }), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('createRegistryClient — OAuth credential transport', () => {
  test('removes hostile cookies and overrides follow/include at the final injected fetch', async () => {
    let calls = 0
    const stubFetch = asFetch(async (input, init) => {
      calls++
      if (!(input instanceof Request)) expect.unreachable()
      expect(input.url).toBe(`${BASE_URL}/v0/health`)
      expect(input.method).toBe('GET')
      expect(input.headers.get('cookie')).toBeNull()
      expect(input.headers.get('authorization')).toBe('Bearer oauth-test')
      expect(input.headers.get('x-client-test')).toBe('preserved')
      expect(input.redirect).toBe('error')
      expect(init?.redirect).toBe('error')
      expect(init?.credentials).toBe('omit')
      expect(init?.signal).toBe(input.signal)
      return healthResponse()
    })
    const client = createRegistryClient({
      baseUrl: BASE_URL,
      credential: 'oauth-test',
      credentialPolicy: 'oauth',
      fetch: stubFetch,
    })
    const { data } = await client.GET('/v0/health', {
      headers: { Cookie: 'ambient=test', 'x-client-test': 'preserved' },
      redirect: 'follow',
      credentials: 'include',
    })
    expect(data?.status).toBe('ok')
    expect(calls).toBe(1)
  })

  test('preserves POST bytes and caller cancellation through a middleware-injected Request', async () => {
    const controller = new AbortController()
    const body = 'archive\u0000bytes\u00ff'
    let calls = 0
    const stubFetch = asFetch(async (input, init) => {
      calls++
      if (!(input instanceof Request)) expect.unreachable()
      expect(input.method).toBe('POST')
      expect(await input.text()).toBe(body)
      expect(input.headers.get('authorization')).toBe('Bearer oauth-post')
      expect(input.headers.get('cookie')).toBeNull()
      expect(input.headers.get('content-type')).toBe('application/gzip')
      expect(input.headers.get('x-injected')).toBe('retained')
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBe(input.signal)
      expect(input.signal.aborted).toBe(false)
      controller.abort()
      expect(input.signal.aborted).toBe(true)
      return new Response(JSON.stringify({ name: 'example', version: '0.1.0' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createRegistryClient({
      baseUrl: BASE_URL,
      credential: 'oauth-post',
      credentialPolicy: 'oauth',
      fetch: stubFetch,
    })
    client.use({
      onRequest({ request }) {
        const headers = new Headers(request.headers)
        headers.set('cookie', 'injected=test')
        headers.set('x-injected', 'retained')
        return new Request(request, { headers, redirect: 'follow', credentials: 'include' })
      },
    })
    await client.POST('/v0/facets/{name}/versions', {
      params: { path: { name: 'example' } },
      headers: { 'content-type': 'application/gzip' },
      body,
      bodySerializer: (value) => value,
      signal: controller.signal,
    })
    expect(calls).toBe(1)
  })

  test('keeps explicit manual archive 302 observable without requesting its target', async () => {
    let calls = 0
    const archiveUrl = 'https://archive.test/presigned'
    const stubFetch = asFetch(async (input, init) => {
      calls++
      if (!(input instanceof Request)) expect.unreachable()
      expect(input.url).toBe(`${BASE_URL}/v0/facets/example/0.1.0/archive`)
      expect(input.headers.get('authorization')).toBe('Bearer oauth-archive')
      expect(input.redirect).toBe('manual')
      expect(init?.redirect).toBe('manual')
      expect(init?.credentials).toBe('omit')
      return new Response(null, { status: 302, headers: { location: archiveUrl } })
    })
    const client = createRegistryClient({
      baseUrl: BASE_URL,
      credential: 'oauth-archive',
      credentialPolicy: 'oauth',
      fetch: stubFetch,
    })
    const result = await resolveArchiveUrl(client, {
      name: 'example',
      version: '0.1.0',
      transportHash: `sha256:${'0'.repeat(64)}`,
      contentFingerprint: `sha256:${'0'.repeat(64)}`,
    })
    expect(result).toEqual({ ok: true, value: archiveUrl })
    expect(calls).toBe(1)
  })

  test('native fetch rejects an automatic redirect before contacting its target', async () => {
    let originalCalls = 0
    let targetCalls = 0
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === '/redirect-target') {
          targetCalls++
          return healthResponse()
        }
        originalCalls++
        return new Response(null, { status: 302, headers: { location: '/redirect-target' } })
      },
    })
    try {
      const client = createRegistryClient({
        baseUrl: server.url.toString(),
        credential: 'oauth-loopback',
        credentialPolicy: 'oauth',
        retry: { maxAttempts: 1 },
      })
      await expect(client.GET('/v0/health', { redirect: 'follow' })).rejects.toThrow()
      expect(originalCalls).toBe(1)
      expect(targetCalls).toBe(0)
    } finally {
      server.stop(true)
    }
  })

  test('each OAuth client keeps its own bearer when sharing the injected transport', async () => {
    const observed: Array<string | null> = []
    const stubFetch = asFetch(async (input) => {
      if (!(input instanceof Request)) expect.unreachable()
      observed.push(input.headers.get('authorization'))
      return healthResponse()
    })
    const first = createRegistryClient({
      baseUrl: BASE_URL,
      credential: 'oauth-first',
      credentialPolicy: 'oauth',
      fetch: stubFetch,
    })
    const second = createRegistryClient({
      baseUrl: BASE_URL,
      credential: 'oauth-second',
      credentialPolicy: 'oauth',
      fetch: stubFetch,
    })
    await Promise.all([first.GET('/v0/health'), second.GET('/v0/health')])
    expect(observed.sort()).toEqual(['Bearer oauth-first', 'Bearer oauth-second'])
  })

  test('retains injected preconnect and wraps every retry dispatch', async () => {
    let calls = 0
    let preconnectReads = 0
    const stubFetch = asFetch(async (input, init) => {
      calls++
      if (!(input instanceof Request)) expect.unreachable()
      expect(input.headers.get('cookie')).toBeNull()
      expect(input.headers.get('authorization')).toBe('Bearer oauth-retry')
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('error')
      if (calls === 1) throw new TypeError('transient test failure')
      return healthResponse()
    })
    const preconnect = stubFetch.preconnect
    Object.defineProperty(stubFetch, 'preconnect', {
      get() {
        preconnectReads++
        return preconnect
      },
    })
    const client = createRegistryClient({
      baseUrl: BASE_URL,
      credential: 'oauth-retry',
      credentialPolicy: 'oauth',
      fetch: stubFetch,
      retry: { baseBackoffMs: 1, jitter: 0 },
    })
    const { data } = await client.GET('/v0/health', { headers: { cookie: 'ambient=test' } })
    expect(data?.status).toBe('ok')
    expect(calls).toBe(2)
    expect(preconnectReads).toBe(1)
  })

  test('default PAT and anonymous clients preserve caller cookie/redirect/transport behavior', async () => {
    for (const credential of ['pat-test', undefined]) {
      let calls = 0
      const stubFetch = asFetch(async (input, init) => {
        calls++
        if (!(input instanceof Request)) expect.unreachable()
        expect(input.headers.get('cookie')).toBe('caller=test')
        expect(input.headers.get('authorization')).toBe(credential === undefined ? null : `Bearer ${credential}`)
        expect(input.redirect).toBe('follow')
        expect(init).toBeUndefined()
        return healthResponse()
      })
      const client = createRegistryClient({ baseUrl: BASE_URL, credential, fetch: stubFetch })
      await client.GET('/v0/health', {
        headers: { cookie: 'caller=test' },
        redirect: 'follow',
        credentials: 'include',
      })
      expect(calls).toBe(1)
    }
  })
})

describe('createRegistryClient — happy path', () => {
  test('returns typed data on a 2xx response', async () => {
    const stubFetch = asFetch(
      async () =>
        new Response(JSON.stringify({ status: 'ok', version: '0.0.0' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })
    const { data, error } = await client.GET('/v0/health')
    expect(error).toBeUndefined()
    expect(data?.status).toBe('ok')
  })

  test('fetch is called with a signal (timeout middleware wired up)', async () => {
    let observedSignal: AbortSignal | null = null
    const stubFetch = asFetch(async (input, init) => {
      const req =
        input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
      observedSignal = req.signal
      return new Response(JSON.stringify({ status: 'ok', version: '0.0.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })
    await client.GET('/v0/health')
    expect(observedSignal).not.toBeNull()
  })
})

describe('createRegistryClient — Bearer auth middleware', () => {
  /** Capture the Authorization header the client sends on a request. */
  function captureAuthHeader(): {
    fetch: typeof globalThis.fetch
    read: () => string | null
  } {
    let observed: string | null = null
    const fetch = asFetch(async (input, init) => {
      const req =
        input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
      observed = req.headers.get('authorization')
      return new Response(JSON.stringify({ status: 'ok', version: '0.0.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    return { fetch, read: () => observed }
  }

  test('attaches Authorization: Bearer when a credential is supplied', async () => {
    const cap = captureAuthHeader()
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: cap.fetch, credential: 'fct_pub_abc' })
    await client.GET('/v0/health')
    expect(cap.read()).toBe('Bearer fct_pub_abc')
  })

  test('sends no Authorization header when no credential is supplied', async () => {
    const cap = captureAuthHeader()
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: cap.fetch })
    await client.GET('/v0/health')
    expect(cap.read()).toBeNull()
  })

  test('sends the credential unchanged — no inspection or validation', async () => {
    // A malformed token is still sent as-is; the registry decides.
    const cap = captureAuthHeader()
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: cap.fetch, credential: 'not-a-real-token' })
    await client.GET('/v0/health')
    expect(cap.read()).toBe('Bearer not-a-real-token')
  })
})

describe('createRegistryClient — HTTP error responses are NOT retried', () => {
  test('a 404 ends the call after one attempt', async () => {
    let attempts = 0
    const stubFetch = asFetch(async () => {
      attempts++
      return new Response(
        JSON.stringify(
          apiError({
            error: 'facet "missing" not found',
            fix: "run 'facet search' to find available facets",
          }),
        ),
        { status: 404, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })
    const { data, error, response } = await client.GET('/v0/facets/{name}/{version}', {
      params: { path: { name: 'missing', version: 'latest' } },
    })
    expect(attempts).toBe(1)
    expect(data).toBeUndefined()
    expect(error).toBeDefined()
    expect(response.status).toBe(404)
  })

  test('a 5xx ends the call after one attempt — registry envelope preferred over retry', async () => {
    let attempts = 0
    const stubFetch = asFetch(async () => {
      attempts++
      return new Response(
        JSON.stringify(
          apiError({
            code: 'E_REGISTRY_UNAVAILABLE',
            error: 'registry temporarily unavailable',
            fix: 'try again in a moment',
            docs_url: 'https://docs',
          }),
        ),
        { status: 503, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })
    const { error, response } = await client.GET('/v0/health')
    expect(attempts).toBe(1)
    expect(error).toBeDefined()
    expect(response.status).toBe(503)
  })
})

describe('createRegistryClient — network errors retry on idempotent methods', () => {
  test('GET retries on TypeError up to 3 attempts then surfaces NETWORK_ERROR with attempt count', async () => {
    let attempts = 0
    const stubFetch = asFetch(async () => {
      attempts++
      throw new TypeError('fetch failed')
    })
    const client = createRegistryClient({
      baseUrl: BASE_URL,
      fetch: stubFetch,
      retry: { baseBackoffMs: 10, jitter: 0 }, // fast tests
    })
    let caught: unknown
    try {
      await client.GET('/v0/health')
    } catch (err) {
      caught = err
    }
    expect(attempts).toBe(3)
    const translated = translateThrownError(caught)
    if (translated.code !== 'NETWORK_ERROR') expect.unreachable()
    expect(translated.attempts).toBe(3)
    expect(translated.cause).toContain('fetch failed')
  })

  test('GET succeeds when a retry recovers from a transient network failure', async () => {
    let attempts = 0
    const stubFetch = asFetch(async () => {
      attempts++
      if (attempts < 2) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ status: 'ok', version: '0.0.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createRegistryClient({
      baseUrl: BASE_URL,
      fetch: stubFetch,
      retry: { baseBackoffMs: 10, jitter: 0 },
    })
    const { data, error } = await client.GET('/v0/health')
    expect(attempts).toBe(2)
    expect(error).toBeUndefined()
    expect(data?.status).toBe('ok')
  })
})

// Note: the integrated POST-doesn't-retry test is more naturally
// expressed at the middleware level (no need for a real wire body
// shape); see `retry-middleware.test.ts` "PUT is not retried by
// default" for the equivalent assertion exercised in isolation.
