/**
 * Per-call timeout middleware for the typed registry client.
 *
 * Composes a per-call deadline with any caller-supplied abort
 * signal so whichever fires first wins. The deadline applies to
 * the entire call including retries — not per-attempt — so a
 * caller's wall-clock budget is honest no matter how the retry
 * loop unfolds.
 *
 * This middleware is the timeout half of the `registryFetch`
 * migration described in design D11. The composition behavior
 * (caller signal + deadline signal via `AbortSignal.any`) is
 * required by the cli spec's "registry calls have a single
 * per-call deadline that the caller can compose with their own
 * abort signal" requirement.
 */

import type { Middleware } from 'openapi-fetch'

export interface TimeoutConfig {
  /**
   * Per-call wall-clock deadline in milliseconds. The clock starts
   * when `onRequest` runs and covers the entire call including any
   * retries (because `onRequest` runs once per outer call, not per
   * retry attempt — retries inside `onError` re-issue with the
   * same `Request`, whose signal carries the deadline).
   *
   * Default: 10 seconds. Generous enough to absorb a couple of
   * 500ms backoffs plus reasonable round-trips, tight enough that
   * a wedged registry doesn't hang the CLI.
   */
  deadlineMs: number
}

const DEFAULT_DEADLINE_MS = 10_000

export const DEFAULT_TIMEOUT_CONFIG: Readonly<TimeoutConfig> = Object.freeze({
  deadlineMs: DEFAULT_DEADLINE_MS,
})

/**
 * Build a timeout middleware with the given config. Designed to be
 * registered first on the client so its `onRequest` wraps the
 * outgoing request before any other middleware (or retry's inner
 * re-issue) sees it.
 */
export function createTimeoutMiddleware(cfg: Partial<TimeoutConfig> = {}): Middleware {
  const config = { ...DEFAULT_TIMEOUT_CONFIG, ...cfg } as const
  const deadlineMs = config.deadlineMs
  return {
    onRequest({ request }) {
      const deadlineSignal = AbortSignal.timeout(deadlineMs)
      // Compose with caller's signal if present. AbortSignal.any
      // returns a signal that fires when ANY input fires — so a
      // caller-driven abort is honored, and the deadline is the
      // backstop. Today's registryFetch silently overwrote the
      // caller's signal; this middleware preserves it.
      const composed = request.signal ? AbortSignal.any([request.signal, deadlineSignal]) : deadlineSignal
      // Request.signal is read-only, so build a new Request from
      // the existing one, overriding only the signal.
      return new Request(request, { signal: composed })
    },
  }
}
