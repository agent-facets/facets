/**
 * Exact-version readiness probe against the public npm registry.
 *
 * `npm publish` succeeding means npm *accepted* the upload, not that the
 * version is available: npm scans new versions before serving them, which
 * typically takes minutes, and may hold or block a version. This probe reports
 * what the public registry currently serves for one exact version, as typed
 * data, so callers can tell "not available yet" apart from rate limiting and
 * failed requests.
 *
 * It makes exactly one request with no npm disk cache and no hidden retries.
 * It does not bypass registry/CDN caching, and public metadata cannot tell a
 * version still being scanned apart from one that is held or blocked.
 */

import { io } from './io'

export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org'

/** Response details worth logging when diagnosing slow availability. */
export interface ProbeDiagnostics {
  durationMs: number
  /** HTTP status, or null when no response arrived. */
  status: number | null
  cacheControl: string | null
  age: string | null
  cacheStatus: string | null
  lastModified: string | null
}

export type ReadinessProbe =
  | { outcome: 'ready'; diagnostics: ProbeDiagnostics }
  /** The registry answered, but does not (yet) serve this version — or this package. */
  | { outcome: 'version-absent'; diagnostics: ProbeDiagnostics }
  | { outcome: 'rate-limited'; retryAfterMs: number | null; diagnostics: ProbeDiagnostics }
  | { outcome: 'timeout'; timeoutMs: number; diagnostics: ProbeDiagnostics }
  | { outcome: 'network-error'; detail: string; diagnostics: ProbeDiagnostics }
  | { outcome: 'http-error'; status: number; diagnostics: ProbeDiagnostics }
  | { outcome: 'invalid-metadata'; detail: string; diagnostics: ProbeDiagnostics }

export interface ProbeOptions {
  /** Abandon the request (including the body read) after this many milliseconds. */
  timeoutMs: number
  now?: () => number
}

/** Packument URL for a package, escaped the way npm escapes scoped names. */
export function packumentUrl(pkg: string): string {
  return `${PUBLIC_NPM_REGISTRY}/${pkg.replace('/', '%2f')}`
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into a delay. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - nowMs)
}

type Fetched = { response: Response; body: string | null }

/**
 * Fetch a packument, handing the response to `onHeaders` as soon as headers
 * arrive so its diagnostics survive a body read that fails or stalls. Only a
 * 200 body is read; the caller discards any other.
 */
async function fetchPackument(
  url: string,
  signal: AbortSignal,
  onHeaders: (response: Response) => void,
): Promise<Fetched> {
  const response = await io.npm.fetchPackument(url, signal)
  onHeaders(response)
  const body = response.status === 200 ? await response.text() : null
  return { response, body }
}

/** Release a body that will never be read, without waiting on — or failing from — the cancellation. */
function discardBody(response: Response): void {
  if (response.body === null || response.bodyUsed) return
  void response.body.cancel().catch(() => {})
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function diagnose(response: Response | null, durationMs: number): ProbeDiagnostics {
  return {
    durationMs,
    status: response?.status ?? null,
    cacheControl: response?.headers.get('cache-control') ?? null,
    age: response?.headers.get('age') ?? null,
    cacheStatus: response?.headers.get('cf-cache-status') ?? null,
    lastModified: response?.headers.get('last-modified') ?? null,
  }
}

function interpretPackument(pkg: string, version: string, body: string, diagnostics: ProbeDiagnostics): ReadinessProbe {
  let doc: unknown
  try {
    doc = JSON.parse(body)
  } catch {
    return { outcome: 'invalid-metadata', detail: 'response body is not JSON', diagnostics }
  }
  if (!isRecord(doc)) {
    return { outcome: 'invalid-metadata', detail: 'packument is not an object', diagnostics }
  }
  if (doc.name !== pkg) {
    return { outcome: 'invalid-metadata', detail: `packument is for ${JSON.stringify(doc.name)}`, diagnostics }
  }
  if (!isRecord(doc.versions)) {
    return { outcome: 'invalid-metadata', detail: 'packument has no versions object', diagnostics }
  }
  const entry = doc.versions[version]
  if (entry === undefined) {
    return { outcome: 'version-absent', diagnostics }
  }
  if (!isRecord(entry) || entry.name !== pkg || entry.version !== version) {
    return {
      outcome: 'invalid-metadata',
      detail: `versions["${version}"] does not describe ${pkg}@${version}`,
      diagnostics,
    }
  }
  return { outcome: 'ready', diagnostics }
}

/** Ask the public registry whether it currently serves `pkg@version`. */
export async function probeVersion(pkg: string, version: string, options: ProbeOptions): Promise<ReadinessProbe> {
  const now = options.now ?? Date.now
  const started = now()
  const controller = new AbortController()
  // Set once headers arrive, so a body that fails or stalls is still reported
  // with the status and cache headers the registry sent.
  let received: Response | null = null
  let didTimeOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // Racing against the timer bounds how long the probe waits, even if the fetch
  // implementation ignores the abort signal. Releasing a stalled body relies on
  // the abort itself: Bun's fetch rejects a pending body read with AbortError.
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      didTimeOut = true
      resolve(null)
      controller.abort()
    }, options.timeoutMs)
  })

  let fetched: Fetched | null
  try {
    const request = fetchPackument(packumentUrl(pkg), controller.signal, (response) => {
      received = response
    })
    fetched = await Promise.race([request, timedOut])
  } catch (error) {
    const diagnostics = diagnose(received, now() - started)
    if (didTimeOut) return { outcome: 'timeout', timeoutMs: options.timeoutMs, diagnostics }
    const detail = error instanceof Error ? error.message : String(error)
    return { outcome: 'network-error', detail, diagnostics }
  } finally {
    clearTimeout(timer)
  }

  if (fetched === null) {
    return { outcome: 'timeout', timeoutMs: options.timeoutMs, diagnostics: diagnose(received, now() - started) }
  }

  const { response, body } = fetched
  const diagnostics = diagnose(response, now() - started)
  if (response.status === 200 && body !== null) return interpretPackument(pkg, version, body, diagnostics)

  // Only the status and headers matter for any other response. Stop its body
  // from downloading past the request budget and piling up across polls.
  discardBody(response)
  controller.abort()

  if (response.status === 404) return { outcome: 'version-absent', diagnostics }
  if (response.status === 429) {
    return {
      outcome: 'rate-limited',
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), now()),
      diagnostics,
    }
  }
  return { outcome: 'http-error', status: response.status, diagnostics }
}

function describeDiagnostics(d: ProbeDiagnostics): string {
  const parts = [d.status === null ? 'no response' : `HTTP ${d.status}`, `${d.durationMs}ms`]
  if (d.cacheStatus) parts.push(`cache ${d.cacheStatus}`)
  if (d.age) parts.push(`age ${d.age}s`)
  if (d.cacheControl) parts.push(d.cacheControl)
  if (d.lastModified) parts.push(`modified ${d.lastModified}`)
  return parts.join(', ')
}

/** One-line, log-friendly description of a probe result. */
export function describeProbe(probe: ReadinessProbe): string {
  const detail = describeDiagnostics(probe.diagnostics)
  switch (probe.outcome) {
    case 'ready':
      return `available [${detail}]`
    case 'version-absent':
      return probe.diagnostics.status === 404
        ? `not available yet: package not found [${detail}]`
        : `not available yet: version not in packument [${detail}]`
    case 'rate-limited':
      return probe.retryAfterMs === null
        ? `rate limited, no Retry-After [${detail}]`
        : `rate limited, Retry-After ${Math.ceil(probe.retryAfterMs / 1000)}s [${detail}]`
    case 'timeout':
      return `request timed out after ${probe.timeoutMs}ms [${detail}]`
    case 'network-error':
      return `request failed: ${probe.detail} [${detail}]`
    case 'http-error':
      return `unexpected HTTP ${probe.status} [${detail}]`
    case 'invalid-metadata':
      return `invalid metadata: ${probe.detail} [${detail}]`
    default: {
      const unreachable: never = probe
      throw new Error(`Unhandled probe outcome: ${JSON.stringify(unreachable)}`)
    }
  }
}
