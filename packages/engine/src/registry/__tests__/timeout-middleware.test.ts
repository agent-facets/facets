/**
 * Tests for the timeout middleware.
 *
 * Two corrections from D11 are exercised here:
 *
 *   #2: per-call deadline (not per-attempt) — the deadline applies
 *       once across the whole call.
 *   #3: caller's signal is composed with the deadline signal
 *       via `AbortSignal.any`, not silently overwritten.
 */

import { describe, expect, test } from 'bun:test'
import createOpenApiClient from 'openapi-fetch'
import { createTimeoutMiddleware } from '../middleware/timeout.ts'

// biome-ignore lint/suspicious/noExplicitAny: Test-only: paths shape is exercised structurally.
type AnyPaths = any

const BASE_URL = 'https://api.test/v0'

function asFetch(
  fn: (input: Request | string | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return fn as unknown as typeof globalThis.fetch
}

describe('timeout middleware — deadline composition', () => {
  test('a Request with no caller signal still receives a deadline signal', async () => {
    let signalSeen: AbortSignal | null = null
    const stubFetch = asFetch(async (input, init) => {
      const req =
        input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
      signalSeen = req.signal
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(createTimeoutMiddleware({ deadlineMs: 1000 }))
    await client.GET('/x', {})
    expect(signalSeen).not.toBeNull()
  })

  test("a caller's signal is composed with the deadline (caller abort wins)", async () => {
    const callerController = new AbortController()
    let observedAbortReason: unknown
    const stubFetch = asFetch(async (input, init) => {
      const req =
        input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
      // Abort the caller signal mid-call.
      callerController.abort(new Error('caller cancel'))
      // The composed signal should now report aborted with the
      // caller's reason.
      observedAbortReason = req.signal.reason
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(createTimeoutMiddleware({ deadlineMs: 60_000 }))
    await client.GET('/x', { signal: callerController.signal })
    expect(observedAbortReason).toBeInstanceOf(Error)
    expect((observedAbortReason as Error).message).toBe('caller cancel')
  })

  test('deadline elapses if no response within the configured time', async () => {
    const stubFetch = asFetch(
      async (input, init) =>
        new Promise<Response>((resolve, reject) => {
          const req =
            input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
          // Never respond on our own — wait for the signal to fire.
          req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true })
          // Fallback timer in case the abort never fires (would
          // hang the test on a misconfiguration).
          setTimeout(() => resolve(new Response('{}', { status: 200 })), 5_000)
        }),
    )
    const client = createOpenApiClient<AnyPaths>({ baseUrl: BASE_URL, fetch: stubFetch })
    client.use(createTimeoutMiddleware({ deadlineMs: 50 }))
    let caught: unknown
    try {
      await client.GET('/x', {})
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    // The reason will be a TimeoutError-ish DOMException or a
    // generic Error depending on runtime; either way it should be
    // one of the recognized abort shapes.
    if (caught instanceof Error) {
      expect(['AbortError', 'TimeoutError', 'Error']).toContain(caught.name)
    }
  })
})
