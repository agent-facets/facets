import { createRegistryClient } from './client.ts'
import { getRegistryBaseUrl } from './http.ts'

const AUTHORIZATION_ENDPOINT = 'https://api.workos.com/user_management/authorize/device'
const TOKEN_ENDPOINT = 'https://api.workos.com/user_management/authenticate'
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 64 * 1024

const ENABLED_KEYS = [
  'authorization_endpoint',
  'client_id',
  'enabled',
  'issuer',
  'onboarding_url',
  'provider',
  'token_endpoint',
  'verification_origin',
]
const DISABLED_KEYS = ['enabled', 'provider']

export interface CliAuthConfig {
  readonly registryOrigin: string
  readonly provider: 'workos'
  readonly clientId: string
  readonly issuer: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly verificationOrigin: string
  readonly onboardingUrl: string
}

export type CliConfigFailure =
  | { code: 'INVALID_REGISTRY_ORIGIN' }
  | { code: 'CLI_AUTH_DISABLED'; provider: 'cognito' | 'workos' }
  | { code: 'CLI_CONFIG_UNAVAILABLE'; status?: number }
  | { code: 'INVALID_CLI_CONFIG' }

export type CliConfigResult<T> = { ok: true; value: T } | { ok: false; error: CliConfigFailure }

export interface CliConfigOptions {
  registryUrl?: string
  allowHttpLoopback?: boolean
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Validate and normalize the registry selection before any network request.
 * HTTP is reserved for explicit loopback tests; production selections require
 * a bare HTTPS origin.
 */
export function validateRegistryOrigin(raw: string, allowHttpLoopback = false): CliConfigResult<string> {
  const origin = parseBareOrigin(raw, allowHttpLoopback)
  return origin === undefined ? { ok: false, error: { code: 'INVALID_REGISTRY_ORIGIN' } } : { ok: true, value: origin }
}

/**
 * Fetch and validate the public OAuth configuration for one selected registry.
 * The normalized registry origin is captured once and returned with the frozen
 * metadata so later authentication calls can stay bound to the same authority.
 */
export async function fetchCliAuthConfig(
  options: CliConfigOptions = {},
): Promise<CliConfigResult<Readonly<CliAuthConfig>>> {
  if (options.signal?.aborted) return { ok: false, error: { code: 'CLI_CONFIG_UNAVAILABLE' } }
  const selectedRegistryUrl = options.registryUrl ?? getRegistryBaseUrl()
  const registry = validateRegistryOrigin(selectedRegistryUrl, options.allowHttpLoopback)
  if (!registry.ok) return registry

  const registryOrigin = registry.value
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(
    () => controller.abort(new DOMException('config deadline expired', 'TimeoutError')),
    timeoutMs,
  )
  const fetch = createAnonymousFetch(options.fetch ?? globalThis.fetch, controller.signal)
  const client = createRegistryClient({
    baseUrl: registryOrigin,
    fetch,
    timeout: { deadlineMs: timeoutMs },
  })

  try {
    const { data, error, response } = await client.GET('/v0/auth/cli/config', {
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    })
    if (!response.ok) {
      return { ok: false, error: { code: 'CLI_CONFIG_UNAVAILABLE', status: response.status } }
    }
    if (error !== undefined || data === undefined) {
      return { ok: false, error: { code: 'INVALID_CLI_CONFIG' } }
    }
    return validateCliConfig(data, registryOrigin, options.allowHttpLoopback === true)
  } catch {
    return { ok: false, error: { code: 'CLI_CONFIG_UNAVAILABLE' } }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}

function validateCliConfig(
  value: unknown,
  registryOrigin: string,
  allowHttpLoopback: boolean,
): CliConfigResult<Readonly<CliAuthConfig>> {
  if (!isRecord(value)) return invalidConfig()

  if (value.enabled === false) {
    if (!hasExactKeys(value, DISABLED_KEYS) || (value.provider !== 'cognito' && value.provider !== 'workos')) {
      return invalidConfig()
    }
    return { ok: false, error: { code: 'CLI_AUTH_DISABLED', provider: value.provider } }
  }

  if (value.enabled !== true || value.provider !== 'workos' || !hasExactKeys(value, ENABLED_KEYS)) {
    return invalidConfig()
  }

  const clientId = value.client_id
  const issuer = value.issuer
  const authorizationEndpoint = value.authorization_endpoint
  const tokenEndpoint = value.token_endpoint
  const verificationOrigin = value.verification_origin
  const onboardingUrl = value.onboarding_url
  const normalizedVerificationOrigin =
    typeof verificationOrigin === 'string' ? parseBareOrigin(verificationOrigin, false) : undefined
  if (
    !isTrimmedNonemptyString(clientId) ||
    issuer !== `https://api.workos.com/user_management/${clientId}` ||
    authorizationEndpoint !== AUTHORIZATION_ENDPOINT ||
    tokenEndpoint !== TOKEN_ENDPOINT ||
    normalizedVerificationOrigin === undefined ||
    normalizedVerificationOrigin !== verificationOrigin ||
    typeof onboardingUrl !== 'string' ||
    !isValidOnboardingUrl(onboardingUrl, allowHttpLoopback)
  ) {
    return invalidConfig()
  }

  return {
    ok: true,
    value: Object.freeze({
      registryOrigin,
      provider: 'workos',
      clientId,
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      verificationOrigin,
      onboardingUrl,
    }),
  }
}

/** Bun currently reports `Request.credentials` as `include` regardless of
 * RequestInit, so enforce the anonymous policy again on the actual fetch call. */
function createAnonymousFetch(fetchImpl: typeof globalThis.fetch, signal: AbortSignal): typeof globalThis.fetch {
  const anonymousFetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const incoming = input instanceof Request ? input : new Request(input.toString(), init)
    const headers = new Headers(incoming.headers)
    headers.delete('authorization')
    headers.delete('cookie')
    const request = new Request(incoming, { headers, redirect: 'error', signal })
    const pending = fetchImpl(request, { redirect: 'error', credentials: 'omit', signal }).then((response) => {
      if (signal.aborted) void response.body?.cancel().catch(() => {})
      return response
    })
    const response = await untilAborted(pending, signal)
    if (response.body === null) return response
    return new Response(boundedBody(response.body, signal), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  anonymousFetch.preconnect = fetchImpl.preconnect
  return anonymousFetch
}

/** Bound OpenAPI's body parsing without turning body failures into another header request. */
function boundedBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let totalBytes = 0
  let released = false
  const release = (cancel: boolean) => {
    if (released) return
    released = true
    if (cancel) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await untilAborted(reader.read(), signal)
        if (chunk.done) {
          release(false)
          controller.close()
          return
        }
        totalBytes += chunk.value.byteLength
        if (totalBytes > MAX_RESPONSE_BYTES) throw new RangeError('config response exceeds byte limit')
        controller.enqueue(chunk.value)
      } catch (error) {
        release(true)
        controller.error(error)
      }
    },
    cancel() {
      release(true)
    },
  })
}

async function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The operation may have rejected synchronously while cancelling its caller.
    void pending.catch(() => {})
    throw signal.reason
  }
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    const result = await Promise.race([pending, cancelled])
    if (signal.aborted) throw signal.reason
    return result
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort)
  }
}

function parseBareOrigin(raw: string, allowHttpLoopback: boolean): string | undefined {
  if (raw.length === 0 || raw.trim() !== raw || /\s/.test(raw)) return undefined
  const rawSuffix = serializedUrlSuffix(raw)
  if (rawSuffix !== '' && rawSuffix !== '/') return undefined

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }

  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return undefined
  }
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && allowHttpLoopback && hasExplicitLoopbackHostname(raw, url.hostname)) {
    return url.origin
  }
  return undefined
}

function isValidOnboardingUrl(raw: string, allowHttpLoopback: boolean): boolean {
  if (raw.length === 0 || raw.trim() !== raw || /\s/.test(raw)) return false
  if (serializedUrlSuffix(raw) !== '/auth/onboarding') return false

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/auth/onboarding' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return false
  }
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && allowHttpLoopback && hasExplicitLoopbackHostname(raw, url.hostname))
  )
}

function serializedUrlSuffix(raw: string): string | undefined {
  const schemeEnd = raw.indexOf('://')
  if (schemeEnd <= 0) return undefined
  const authorityStart = schemeEnd + 3
  const boundaryOffset = raw.slice(authorityStart).search(/[/?#\\]/)
  return boundaryOffset === -1 ? '' : raw.slice(authorityStart + boundaryOffset)
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function hasExplicitLoopbackHostname(raw: string, normalizedHostname: string): boolean {
  const authority = raw.slice('http://'.length).split('/', 1)[0] ?? ''
  const rawHostname = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1)
    : (authority.split(':', 1)[0] ?? '')
  return isLoopbackHostname(normalizedHostname) && isLoopbackHostname(rawHostname.toLowerCase())
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS
  return Math.max(1, Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function isTrimmedNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function invalidConfig<T>(): CliConfigResult<T> {
  return { ok: false, error: { code: 'INVALID_CLI_CONFIG' } }
}
