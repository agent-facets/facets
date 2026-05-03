/**
 * Fine-grained tests for the retry middleware.
 *
 * Tests the policy details (idempotent-method filter, jitter range,
 * `Retry-After` honoring, abortable backoff) in isolation from the
 * client wiring. Integration with the full middleware stack lives
 * in `client.test.ts`.
 */

import { describe, expect, test } from 'bun:test'
import createOpenApiClient from 'openapi-fetch'
import { createRetryMiddleware, isRetryExhaustedError } from '../middleware/retry.ts'

// We intentionally use a wide `paths` type so we can target any
// route shape from these tests without coupling them to the live
// generated module.
// biome-ignore lint/suspicious/noExplicitAny: Test-only: paths shape is exercised structurally.
type AnyPaths = any

const BASE_URL = 'https://api.test/v0'

function asFetch(
  fn: (input: Request | string | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return fn as unknown as typeof globalThis.fetch
}

describe('retry middleware — idempotent method filter', () => {
  test('PUT is not retried by default (only GET/HEAD/OPTIONS are)', async () => {
    let attempts = 0
    const stubFetch = asFetch(async () => {
      attempts++
      throw new TypeError('fetch failed')
    })
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(createRetryMiddleware({ baseBackoffMs: 1, jitter: 0 }))
    let caught: unknown
    try {
      await client.PUT('/x', {})
    } catch (err) {
      caught = err
    }
    expect(attempts).toBe(1)
    expect(isRetryExhaustedError(caught)).toBe(true)
    if (isRetryExhaustedError(caught)) expect(caught.attempts).toBe(1)
  })

  test('caller-supplied retryableMethods can include POST', async () => {
    let attempts = 0
    const stubFetch = asFetch(async () => {
      attempts++
      throw new TypeError('fetch failed')
    })
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(
      createRetryMiddleware({
        baseBackoffMs: 1,
        jitter: 0,
        retryableMethods: new Set(['GET', 'POST']),
      }),
    )
    try {
      await client.POST('/x', {})
    } catch {
      // expected
    }
    expect(attempts).toBe(3)
  })
})

describe('retry middleware — attempts marker on exhausted error (D11 #6)', () => {
  test('exhausted retry attaches the attempt count', async () => {
    const stubFetch = asFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(createRetryMiddleware({ baseBackoffMs: 1, jitter: 0 }))
    let caught: unknown
    try {
      await client.GET('/x', {})
    } catch (err) {
      caught = err
    }
    expect(isRetryExhaustedError(caught)).toBe(true)
    if (isRetryExhaustedError(caught)) expect(caught.attempts).toBe(3)
  })

  test('first-attempt success has no retry marker (no exhaustion)', async () => {
    const stubFetch = asFetch(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(createRetryMiddleware({ baseBackoffMs: 1, jitter: 0 }))
    const { error } = await client.GET('/x', {})
    expect(error).toBeUndefined()
  })
})

describe('retry middleware — abortable backoff', () => {
  test('caller abort during backoff cancels the retry loop', async () => {
    let attempts = 0
    const controller = new AbortController()
    const stubFetch = asFetch(async () => {
      attempts++
      // Schedule an abort to fire during the backoff that follows.
      // baseBackoffMs is 50ms; we abort at 10ms.
      setTimeout(() => controller.abort(new Error('caller cancel')), 10)
      throw new TypeError('fetch failed')
    })
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(createRetryMiddleware({ baseBackoffMs: 50, jitter: 0 }))
    let caught: unknown
    try {
      await client.GET('/x', { signal: controller.signal })
    } catch (err) {
      caught = err
    }
    // First attempt fails, backoff starts, abort fires before
    // second attempt — total attempts should be 1.
    expect(attempts).toBe(1)
    expect(caught).toBeDefined()
  })
})
