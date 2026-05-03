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

const BASE_URL = 'https://api.test/v0'

/**
 * Wrap a stub function so it satisfies Bun's `typeof fetch` (which
 * includes `preconnect`) without each test having to repeat the
 * cast-through-unknown dance.
 */
function asFetch(
  fn: (input: Request | string | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return fn as unknown as typeof globalThis.fetch
}

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

describe('createRegistryClient — HTTP error responses are NOT retried', () => {
  test('a 404 ends the call after one attempt', async () => {
    let attempts = 0
    const stubFetch = asFetch(async () => {
      attempts++
      return new Response(
        JSON.stringify({
          error: 'facet "missing" not found',
          code: 'E_FACET_NOT_FOUND',
          docsUrl: 'https://agentfacets.io/errors/E_FACET_NOT_FOUND',
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })
    const { data, error, response } = await client.GET('/v0/packages/{name}', {
      params: { path: { name: 'missing' } },
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
        JSON.stringify({
          error: 'registry temporarily unavailable',
          code: 'E_REGISTRY_UNAVAILABLE',
          docsUrl: 'https://docs',
        }),
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
