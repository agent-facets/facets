import { getRegistryBaseUrl } from '@agent-facets/engine'
import type { CliError } from './errors.ts'
import { isRegistryErrorResponse, translateRegistryError } from './registry-errors.ts'

// Re-exported from engine so commands can import URL helpers from a single
// place. Engine owns the env-var lookup and encoding rules so the install
// pipeline and the standalone CLI commands can never disagree.
export { encodeFacetName, getRegistryBaseUrl } from '@agent-facets/engine'

/** Hard wall-clock per HTTP attempt. Conservative on a conference network. */
const REQUEST_TIMEOUT_MS = 5000

/** Number of retries on network failure (initial attempt is not counted). */
const NETWORK_RETRIES = 2

/** Backoff between retries. Constant — V0 doesn't need exponential. */
const RETRY_BACKOFF_MS = 500

/**
 * Outcome of a `registryFetch` call. Discriminated by `ok` so callers can
 * branch without try/catch noise.
 *
 * `failure` always carries a CliError ready to feed to `writeCliError`.
 * `kind` lets callers distinguish "server said no" from "couldn't reach
 * the server" — same final shape, different downstream handling
 * (e.g., publish should not auto-retry on `server-error`).
 */
export type RegistryFetchResult =
  | { ok: true; response: Response }
  | { ok: false; failure: CliError; kind: 'network' | 'server-error' }

/**
 * Fetch a registry path with retry/timeout/error-translation baked in.
 *
 * `path` is appended to the resolved base URL; pass either an absolute
 * `/packages/...` form or a relative form. URL-encoding of facet names
 * is the caller's job — use `encodeFacetName` first.
 *
 * Behavior:
 *   - Per-attempt 5s timeout via AbortController.
 *   - Up to 2 retries on network failure (DNS/TCP/timeout) with 500ms backoff.
 *   - HTTP error responses are NOT retried (server already responded).
 *   - Error responses are JSON-decoded; if they match the registry's
 *     `{error,code,docsUrl}` Tier 2 contract, they're translated via
 *     `translateRegistryError` so callers get a ready-to-print CliError.
 *   - Non-JSON or non-Tier-2 error bodies surface as `E_REGISTRY_UNAVAILABLE`-shaped
 *     CliErrors (server is responding but speaking a dialect we don't know).
 */
export async function registryFetch(path: string, init?: RequestInit): Promise<RegistryFetchResult> {
  const url = `${getRegistryBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  let lastNetworkError: Error | undefined
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timeout)
      if (response.ok) return { ok: true, response }
      const failure = await translateHttpFailure(response)
      return { ok: false, failure, kind: 'server-error' }
    } catch (err) {
      clearTimeout(timeout)
      lastNetworkError = err instanceof Error ? err : new Error(String(err))
      // Non-network errors (e.g. invalid URL) shouldn't be retried.
      if (!isNetworkError(lastNetworkError)) break
    }
  }
  return {
    ok: false,
    kind: 'network',
    failure: {
      what: 'registry temporarily unavailable',
      detail: lastNetworkError ? lastNetworkError.message : 'unknown network failure',
      fix: 'try again in a moment',
      docsUrl: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
    },
  }
}

async function translateHttpFailure(response: Response): Promise<CliError> {
  // Try to parse the registry's Tier 2 error envelope. Body might not be JSON
  // (gateway 502 page, empty 503 from a load balancer, etc.) — degrade
  // gracefully rather than throwing inside the error path.
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (isRegistryErrorResponse(body)) return translateRegistryError(body)
  return {
    what: 'registry returned an unexpected response',
    detail: `HTTP ${response.status} ${response.statusText}`,
    fix: 'try again in a moment',
    docsUrl: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
  }
}

function isNetworkError(err: Error): boolean {
  // AbortError (timeout) is a transient network problem — retry.
  if (err.name === 'AbortError') return true
  // Bun/undici surface DNS/TCP failures with name === 'TypeError' and
  // a message like "fetch failed" or "Unable to connect". Conservative:
  // any TypeError from fetch is a network problem, since fetch validation
  // errors throw before we reach the await.
  if (err.name === 'TypeError') return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
