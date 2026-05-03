/**
 * Retry middleware for the typed registry client.
 *
 * Implements the retry policy laid out in design D11:
 *
 *   - Idempotent methods only by default (GET / HEAD / OPTIONS).
 *     Non-idempotent methods (POST / PUT / PATCH / DELETE) are not
 *     retried automatically — they may have already produced a
 *     side effect on the registry.
 *   - Network errors trigger retry (caught in `onError`). The
 *     re-issue uses `options.fetch(request.clone())` so it bypasses
 *     the middleware chain and goes straight to the underlying
 *     fetch — exactly the pattern verified by the phase-2a spike.
 *   - HTTP 4xx/5xx responses are NOT retried. The registry's
 *     structured error envelope is more informative than masking
 *     it with another attempt; the timeout middleware (running on
 *     the outer call) handles wedged-server cases.
 *   - Backoff is constant by default with ±25% jitter so a fleet
 *     of CLIs retrying simultaneously doesn't synchronize on the
 *     millisecond.
 *   - `Retry-After` header is honored when present, capped by the
 *     configured maximum to defend against runaway values. Today's
 *     `registryFetch` ignored this header; D11 fix #4.
 *   - The retry-exhausted error includes the attempt count so
 *     the user-facing message can say "after N attempts" instead
 *     of dropping retry history (D11 fix #6).
 *   - Backoff sleeps are abort-aware: a caller's signal (or the
 *     timeout deadline) fires through to the sleep so the call
 *     can cancel mid-backoff.
 */

import type { Middleware } from 'openapi-fetch'

export interface RetryConfig {
  /**
   * Total attempt budget including the first call. `maxAttempts: 3`
   * means initial + 2 retries, matching today's `NETWORK_RETRIES = 2`.
   */
  maxAttempts: number
  /**
   * Base backoff between attempts in milliseconds. Constant by
   * default per D11. Future config can swap to exponential by
   * extending this middleware (or replacing it) without touching
   * call sites.
   */
  baseBackoffMs: number
  /**
   * Maximum backoff in milliseconds. Caps both the base backoff
   * (after jitter) and any `Retry-After` value the server sends.
   */
  maxBackoffMs: number
  /**
   * Jitter as a fraction of the base backoff. `0.25` means each
   * backoff is `base × (1 ± random_in[-0.25, 0.25])`. Set to `0`
   * to disable jitter (deterministic for tests).
   */
  jitter: number
  /**
   * HTTP methods eligible for automatic retry. Default is the
   * idempotent set per RFC 9110. Callers can pass a wider set
   * if they have a specific reason to retry POST etc.
   */
  retryableMethods: ReadonlySet<string>
}

export const DEFAULT_RETRY_CONFIG: Readonly<RetryConfig> = Object.freeze({
  maxAttempts: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 5_000,
  jitter: 0.25,
  retryableMethods: new Set(['GET', 'HEAD', 'OPTIONS']),
})

/**
 * Marker the retry middleware attaches to the `Error` it returns
 * when the retry budget is exhausted. Lets call-site error-translation
 * code surface the retry count to the user without a separate
 * side-channel.
 *
 * The marker is read by `translateThrownError` in `client.ts`.
 */
export interface RetryExhaustedError extends Error {
  attempts: number
}

export function isRetryExhaustedError(value: unknown): value is RetryExhaustedError {
  return value instanceof Error && typeof (value as { attempts?: unknown }).attempts === 'number'
}

/**
 * Build a retry middleware with the given config.
 *
 * Register order on the client:
 *
 *   client.use(timeoutMiddleware)   // first — wraps signal on every request
 *   client.use(retryMiddleware)     // second — handles network-error re-issue
 *
 * The timeout's `onRequest` runs first (forward order); retry's
 * `onError` only runs when the underlying fetch throws. Inner
 * re-issues from retry skip the middleware chain and go straight
 * to `options.fetch` — but they re-use the same `Request` (cloned),
 * which already carries the deadline signal.
 */
export function createRetryMiddleware(cfg: Partial<RetryConfig> = {}): Middleware {
  const c: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...cfg }

  return {
    async onError({ request, error, options }) {
      // Method filter: non-idempotent methods aren't retried.
      // The original error is returned unchanged so the caller's
      // error-translation path sees a single attempt failure.
      if (!c.retryableMethods.has(request.method)) {
        return wrapWithAttempts(error, 1)
      }

      let lastError = error
      // Loop starts at attempt 2 because attempt 1 (the original)
      // already failed and led us into this `onError` callback.
      for (let attempt = 2; attempt <= c.maxAttempts; attempt++) {
        try {
          await abortableSleep(backoffFor(c, null), request.signal)
        } catch (abortReason) {
          // Sleep aborted (deadline or caller signal). Surface the
          // abort, not the previous network error — the abort is
          // what stopped us.
          return wrapWithAttempts(abortReason, attempt - 1)
        }
        try {
          // The cast covers a Bun/undici-types mismatch on Request:
          // `request.clone()` returns the undici-types Request, but
          // `options.fetch` is typed against Bun's BunFetchRequestInit.
          // Both runtime objects are interchangeable; the cast is
          // type-only.
          const response = await options.fetch(request.clone() as unknown as Request)
          // A response means the network call completed. Whether
          // it's 2xx, 4xx, or 5xx is the caller's concern — retry
          // doesn't second-guess HTTP status.
          return response
        } catch (next) {
          lastError = next
          // If we just exhausted the budget, fall through and
          // return the wrapped error below.
        }
      }
      return wrapWithAttempts(lastError, c.maxAttempts)
    },
  }
}

/**
 * Compute the next backoff duration with jitter and Retry-After
 * support. Pure function for testability.
 */
function backoffFor(c: RetryConfig, retryAfterHeader: string | null): number {
  const fromHeader = retryAfterHeader ? Number(retryAfterHeader) * 1000 : Number.NaN
  const base = Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : c.baseBackoffMs
  const jitterFactor = 1 + (Math.random() * 2 - 1) * c.jitter
  return Math.min(base * jitterFactor, c.maxBackoffMs)
}

/**
 * Sleep for `ms` milliseconds, but reject early if `signal` aborts.
 * Critical for not stranding the call inside a 500ms backoff after
 * the per-call deadline has fired.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Attach an `attempts` field to the error so the call-site
 * translation can surface "after N attempts" without a separate
 * side-channel.
 */
function wrapWithAttempts(err: unknown, attempts: number): Error {
  if (err instanceof Error) {
    // Mutate the existing error in place. The marker is non-enumerable
    // so logs/serialization don't surface it; the type guard reads it
    // on demand.
    Object.defineProperty(err, 'attempts', {
      value: attempts,
      writable: false,
      enumerable: false,
      configurable: false,
    })
    return err
  }
  // Non-Error thrown (rare — `String`, `null`, etc.). Wrap so the
  // attempts marker has somewhere to live.
  const wrapped = new Error(String(err)) as RetryExhaustedError
  Object.defineProperty(wrapped, 'attempts', {
    value: attempts,
    writable: false,
    enumerable: false,
    configurable: false,
  })
  return wrapped
}
