/**
 * Typed registry client factory.
 *
 * Returns an `openapi-fetch` `Client<paths>` with timeout and retry
 * middleware pre-applied. Call sites use the typed surface
 * directly:
 *
 *   const client = createRegistryClient()
 *   const { data, error, response } = await client.GET(
 *     '/v0/packages/{name}/{version}',
 *     { params: { path: { name, version } } },
 *   )
 *   if (error) {
 *     return { ok: false, error: translateWireError(error, response.status, ...) }
 *   }
 *   // data is fully typed per the registry's OpenAPI spec
 *
 * Translation from wire errors / thrown errors to the internal
 * `RegistryError` discriminator happens at the call site via the
 * helpers exported here, NOT in middleware. Middleware doesn't see
 * the typed error body — `openapi-fetch` populates `error` after
 * the middleware chain returns. Keeping translation as plain
 * functions also makes them trivially unit-testable.
 */

import createOpenApiClient, { type Client } from 'openapi-fetch'
import type { paths } from './generated/registry-api.ts'
import { getRegistryBaseUrl } from './http.ts'
import { createRetryMiddleware, isRetryExhaustedError, type RetryConfig } from './middleware/retry.ts'
import { createTimeoutMiddleware, type TimeoutConfig } from './middleware/timeout.ts'
import type { RegistryError } from './types.ts'
import type { WireErrorResponse } from './wire.ts'

export interface RegistryClientConfig {
  /**
   * Override the registry base URL. Defaults to
   * `getRegistryBaseUrl()` (which reads `FACET_REGISTRY_URL` env).
   * Useful in tests that want to point at a stub server.
   */
  baseUrl?: string
  /**
   * Bearer credential to attach to every outgoing request. When set,
   * an `Authorization: Bearer <credential>` header is added to all
   * requests — reads and writes alike — so authenticated traffic earns
   * the registry's authenticated rate-limit tier. When omitted, no auth
   * header is sent and requests go out anonymously.
   *
   * The factory does no env/file I/O: callers resolve the credential
   * (via `resolveCredential()`) and pass the token here. The factory
   * never inspects or validates the token — a malformed, expired, or
   * revoked token is sent as-is and the registry decides what to do
   * with it.
   */
  credential?: string
  /** Timeout middleware config. Omit to use defaults. */
  timeout?: Partial<TimeoutConfig>
  /** Retry middleware config. Omit to use defaults. */
  retry?: Partial<RetryConfig>
  /**
   * Override the underlying fetch implementation. Useful in tests
   * that want to stub `globalThis.fetch` without polluting global
   * state. If omitted, `openapi-fetch` uses `globalThis.fetch`.
   */
  fetch?: typeof globalThis.fetch
}

/**
 * Build a typed registry client. The returned client is a normal
 * `openapi-fetch` `Client<paths>` — see its docs for the full
 * call-site surface.
 *
 * The order of `client.use(...)` calls matters per `openapi-fetch`'s
 * composition rules: `onRequest` callbacks fire forward (first
 * registered runs first), `onResponse` and `onError` fire in
 * reverse. Registering timeout first means its `onRequest` wraps
 * every outgoing request before any other middleware sees it,
 * and retry's `onError` catches network throws after timeout has
 * already armed the signal.
 */
export function createRegistryClient(cfg: RegistryClientConfig = {}): Client<paths> {
  const client = createOpenApiClient<paths>({
    baseUrl: cfg.baseUrl ?? getRegistryBaseUrl(),
    fetch: cfg.fetch,
  })
  if (cfg.credential !== undefined) {
    client.use(createAuthMiddleware(cfg.credential))
  }
  client.use(createTimeoutMiddleware(cfg.timeout))
  client.use(createRetryMiddleware(cfg.retry))
  return client
}

/**
 * Middleware that attaches `Authorization: Bearer <credential>` to
 * every outgoing request. Registered only when a credential is
 * supplied, so the anonymous path sends no auth header at all. Headers
 * are set on the live `Request` before it is dispatched; `onRequest`
 * fires forward, so this runs before timeout/retry arm the request.
 */
function createAuthMiddleware(credential: string) {
  return {
    onRequest({ request }: { request: Request }) {
      request.headers.set('Authorization', `Bearer ${credential}`)
      return request
    },
  }
}

/**
 * Translate an `openapi-fetch` typed error body plus an HTTP status
 * into the internal `RegistryError` discriminator.
 *
 * Call sites use this on the failure branch of a typed call:
 *
 *   const { data, error, response } = await client.GET(...)
 *   if (error) {
 *     return { ok: false, error: translateWireError(error, response.status, ...) }
 *   }
 *
 * `wire` is typed as `WireErrorResponse` per the OpenAPI spec, but
 * `openapi-fetch` will return the raw text body if it isn't valid
 * JSON (e.g., a CloudFront 502 HTML page, an empty 503, etc.). We
 * defensively narrow to handle that case rather than trusting the
 * spec-derived type to match runtime behavior of every middlebox
 * between client and registry.
 *
 * The optional `notFoundContext` lets the metadata-resolver call
 * site surface a richer NOT_FOUND error (with the requested name +
 * spec) than would be available from the wire envelope alone. Other
 * call sites pass undefined and accept the generic 404.
 */
export function translateWireError(
  wire: WireErrorResponse | string | undefined,
  status: number,
  notFoundContext?: { name: string; spec: string },
): RegistryError {
  if (status === 404 && notFoundContext) {
    return { code: 'NOT_FOUND', name: notFoundContext.name, spec: notFoundContext.spec }
  }
  // If the response body isn't a well-formed structured envelope —
  // raw text, missing, or otherwise non-object — there is no server
  // text to render. Surface UNPARSEABLE_RESPONSE keyed off the HTTP
  // status. Better than throwing on `wire.error` access.
  if (typeof wire !== 'object' || wire === null) {
    return { code: 'UNPARSEABLE_RESPONSE', status }
  }
  // Structured envelope: carry the registry's `code`, `error`, `fix`,
  // and `docs_url` through verbatim. The registry is the single source
  // of truth for what the error means and how to fix it; the CLI does
  // not maintain any local code-to-message map (see design D4).
  return {
    code: 'REGISTRY_REJECTED',
    wireCode: wire.code,
    error: wire.error,
    fix: wire.fix,
    docsUrl: wire.docs_url,
  }
}

/**
 * Translate a thrown error from `openapi-fetch` into a
 * `RegistryError`. Used at call sites that wrap their `client.GET`
 * call in try/catch to recover from genuine network failures and
 * abort signals.
 *
 * The error carries an `attempts` marker if it came from the retry
 * middleware (see `wrapWithAttempts` in `middleware/retry.ts`); we
 * read that to surface honest retry history in the user-facing
 * message.
 *
 * Network-error classification is runtime-specific: Bun's fetch
 * throws a plain `Error` with `code: 'ConnectionRefused'` (and
 * similar codes for DNS / unreachable host); undici's typically
 * throws `TypeError('fetch failed')`; aborts produce `AbortError`
 * / `TimeoutError`. We check all known shapes so a connection
 * refused doesn't get mislabeled as `UNEXPECTED_ERROR`.
 */
export function translateThrownError(err: unknown): RegistryError {
  const attempts = isRetryExhaustedError(err) ? err.attempts : 1
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return {
        code: 'NETWORK_ERROR',
        cause: `request aborted: ${err.message || 'no reason given'}`,
        attempts,
      }
    }
    if (isNetworkError(err)) {
      return {
        code: 'NETWORK_ERROR',
        cause: err.message,
        attempts,
      }
    }
    // Recognized Error but not a known network shape. Surface
    // honestly as UNEXPECTED_ERROR rather than mislabeling as
    // network (D11 fix #5).
    return {
      code: 'UNEXPECTED_ERROR',
      cause: `${err.name}: ${err.message}`,
    }
  }
  // Non-Error thrown (`null`, string, etc.). Surface as unexpected.
  return {
    code: 'UNEXPECTED_ERROR',
    cause: String(err),
  }
}

/**
 * Classify an `Error` as a network-layer failure.
 *
 * Recognizes:
 *
 *   - `TypeError` — undici / browser-side `fetch` for DNS / TCP /
 *     "fetch failed" cases.
 *   - Errors with a Node-style `code` in the well-known network set
 *     (`ConnectionRefused`, `ECONNREFUSED`, `ENOTFOUND`, etc.) —
 *     Bun's fetch throws plain `Error` with one of these codes.
 *   - Errors whose message contains "Unable to connect" / "fetch
 *     failed" / "ECONN" / "ENOTFOUND" — final fallback for
 *     runtimes whose `code` field doesn't follow the convention.
 */
function isNetworkError(err: Error): boolean {
  if (err instanceof TypeError) return true
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string') {
    const NETWORK_CODES = new Set([
      'ConnectionRefused',
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ETIMEDOUT',
      'EAI_AGAIN',
    ])
    if (NETWORK_CODES.has(code)) return true
  }
  const message = err.message
  if (
    message.includes('Unable to connect') ||
    message.includes('fetch failed') ||
    message.includes('ECONN') ||
    message.includes('ENOTFOUND') ||
    message.includes('EHOSTUNREACH')
  ) {
    return true
  }
  return false
}
