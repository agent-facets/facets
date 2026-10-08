import type { CliAuthConfig } from './cli-config.ts'

const AUTHORIZATION_ENDPOINT = 'https://api.workos.com/user_management/authorize/device'
const TOKEN_ENDPOINT = 'https://api.workos.com/user_management/authenticate'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const MIN_POLL_INTERVAL_SECONDS = 5
const MAX_POLL_INTERVAL_SECONDS = 300
const MAX_CHALLENGE_LIFETIME_SECONDS = 3_600
const MAX_POLL_ATTEMPTS = MAX_CHALLENGE_LIFETIME_SECONDS / MIN_POLL_INTERVAL_SECONDS
const MAX_CONSECUTIVE_TRANSIENTS = 3
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const MAX_REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_CLIENT_ID_LENGTH = 512
const MAX_USER_CODE_LENGTH = 128
const MAX_DEVICE_CODE_LENGTH = 4_096
const MAX_TOKEN_LENGTH = 16_384
const MAX_CLAIM_LENGTH = 1_024
// RFC 7519 permits a small clock-skew allowance; one minute covers modest local drift.
const AUTH_TIME_CLOCK_SKEW_MS = 60_000
const MAX_SAFE_UNIX_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1_000)

export interface DeviceAuthorizationDisplay {
  readonly userCode: string
  readonly verificationUri: string
  readonly verificationUriComplete: string
}

export interface DeviceAuthorizationSecret {
  readonly deviceCode: string
}

export interface DeviceAuthorizationChallenge {
  readonly display: Readonly<DeviceAuthorizationDisplay>
  readonly secret: Readonly<DeviceAuthorizationSecret>
  readonly expiresAt: number
  readonly intervalSeconds: number
}

/** Claims are decoded only to reject cross-client/config responses. They are not authenticated identity. */
export interface UntrustedAccessTokenMetadata {
  readonly trust: 'untrusted'
  readonly expiresAt: number
  readonly issuer: string
  readonly clientId: string
  readonly subject: string
  readonly sessionId: string
  readonly authTime: number
}

export interface DeviceTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
  readonly untrustedMetadata: Readonly<UntrustedAccessTokenMetadata>
}

export type RequestDeviceAuthorizationFailure =
  | { code: 'INVALID_AUTH_CONFIG' }
  | { code: 'CANCELLED'; attempted: boolean }
  | { code: 'DEVICE_AUTH_UNAVAILABLE'; reason: 'network' | 'timeout' | 'unexpected-response'; status?: number }
  | { code: 'INVALID_DEVICE_RESPONSE' }

export type PollDeviceAuthorizationFailure =
  | { code: 'INVALID_AUTH_CONFIG' }
  | { code: 'INVALID_DEVICE_CHALLENGE' }
  | { code: 'CANCELLED'; attempted: boolean }
  | { code: 'AUTHORIZATION_DENIED' }
  | { code: 'AUTHORIZATION_EXPIRED' }
  | {
      code: 'POLLING_UNAVAILABLE'
      reason: 'network' | 'timeout' | 'rate-limited' | 'server' | 'unexpected-response'
      status?: number
    }
  | { code: 'INVALID_TOKEN_RESPONSE' }

export type RefreshDeviceTokensFailure =
  | { code: 'INVALID_AUTH_CONFIG' }
  | { code: 'INVALID_REFRESH_TOKEN' }
  | { code: 'CANCELLED'; attempted: false }
  | { code: 'REAUTHENTICATION_REQUIRED' }
  | {
      code: 'REFRESH_TRANSIENT'
      reason: 'cancelled' | 'network' | 'timeout' | 'rate-limited' | 'server'
      attempted: true
      status?: number
    }
  | {
      code: 'REFRESH_UNCERTAIN'
      reason: 'malformed-success' | 'unexpected-response'
      attempted: true
      status?: number
    }

export type RequestDeviceAuthorizationResult =
  | { ok: true; value: Readonly<DeviceAuthorizationChallenge> }
  | { ok: false; error: RequestDeviceAuthorizationFailure }

export type PollDeviceAuthorizationResult =
  | { ok: true; value: Readonly<DeviceTokenPair> }
  | { ok: false; error: PollDeviceAuthorizationFailure }

export type RefreshDeviceTokensResult =
  | { ok: true; value: Readonly<DeviceTokenPair> }
  | { ok: false; error: RefreshDeviceTokensFailure }

export interface DeviceAuthDependencies {
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
  requestTimeoutMs?: number
}

type DispatchFailure = { kind: 'cancelled' | 'network' | 'timeout'; attempted: boolean }
type DispatchResult = { ok: true; response: Response; body: unknown } | { ok: false; failure: DispatchFailure }
type JsonReadResult = { ok: true; value: unknown } | { ok: false; kind: DispatchFailure['kind'] | 'malformed' }

export async function requestDeviceAuthorization(
  config: Readonly<CliAuthConfig>,
  dependencies: DeviceAuthDependencies = {},
): Promise<RequestDeviceAuthorizationResult> {
  if (!isValidConfig(config)) return { ok: false, error: { code: 'INVALID_AUTH_CONFIG' } }

  const dispatched = await dispatchForm(
    config.authorizationEndpoint,
    new URLSearchParams({ client_id: config.clientId }),
    dependencies,
  )
  if (!dispatched.ok) {
    if (dispatched.failure.kind === 'cancelled') {
      return { ok: false, error: { code: 'CANCELLED', attempted: dispatched.failure.attempted } }
    }
    return {
      ok: false,
      error: { code: 'DEVICE_AUTH_UNAVAILABLE', reason: dispatched.failure.kind },
    }
  }

  if (!dispatched.response.ok) {
    return {
      ok: false,
      error: {
        code: 'DEVICE_AUTH_UNAVAILABLE',
        reason: 'unexpected-response',
        status: dispatched.response.status,
      },
    }
  }

  const body = dispatched.body
  const challenge = validateChallengeResponse(body, config, now(dependencies))
  return challenge === undefined
    ? { ok: false, error: { code: 'INVALID_DEVICE_RESPONSE' } }
    : { ok: true, value: challenge }
}

export async function pollDeviceAuthorization(
  config: Readonly<CliAuthConfig>,
  challenge: Readonly<DeviceAuthorizationChallenge>,
  dependencies: DeviceAuthDependencies = {},
): Promise<PollDeviceAuthorizationResult> {
  if (!isValidConfig(config)) return { ok: false, error: { code: 'INVALID_AUTH_CONFIG' } }
  if (!isValidChallenge(challenge, config, now(dependencies))) {
    return { ok: false, error: { code: 'INVALID_DEVICE_CHALLENGE' } }
  }

  let intervalSeconds = challenge.intervalSeconds
  let consecutiveTransients = 0
  for (let attempts = 0; attempts < MAX_POLL_ATTEMPTS; attempts++) {
    const beforeSleep = now(dependencies)
    if (beforeSleep >= challenge.expiresAt) {
      return { ok: false, error: { code: 'AUTHORIZATION_EXPIRED' } }
    }
    if (dependencies.signal?.aborted) {
      return { ok: false, error: { code: 'CANCELLED', attempted: false } }
    }

    const waitMs = Math.min(intervalSeconds * 1_000, challenge.expiresAt - beforeSleep)
    try {
      await (dependencies.sleep ?? abortableSleep)(waitMs, dependencies.signal)
    } catch (error) {
      if (dependencies.signal?.aborted || isAbortError(error)) {
        return { ok: false, error: { code: 'CANCELLED', attempted: false } }
      }
      return { ok: false, error: { code: 'POLLING_UNAVAILABLE', reason: timeoutOrNetwork(error) } }
    }

    if (now(dependencies) >= challenge.expiresAt) {
      return { ok: false, error: { code: 'AUTHORIZATION_EXPIRED' } }
    }

    const dispatched = await dispatchForm(
      config.tokenEndpoint,
      new URLSearchParams({
        grant_type: DEVICE_GRANT,
        device_code: challenge.secret.deviceCode,
        client_id: config.clientId,
      }),
      dependencies,
      Math.min(requestTimeout(dependencies), challenge.expiresAt - now(dependencies)),
    )
    if (!dispatched.ok) {
      if (dispatched.failure.kind === 'cancelled') {
        return { ok: false, error: { code: 'CANCELLED', attempted: dispatched.failure.attempted } }
      }
      consecutiveTransients++
      if (consecutiveTransients >= MAX_CONSECUTIVE_TRANSIENTS) {
        return { ok: false, error: { code: 'POLLING_UNAVAILABLE', reason: dispatched.failure.kind } }
      }
      intervalSeconds = backoff(intervalSeconds)
      continue
    }

    const response = dispatched.response
    const body = dispatched.body
    if (response.ok) {
      const tokens = validateTokenResponse(body, config, now(dependencies))
      return tokens === undefined
        ? { ok: false, error: { code: 'INVALID_TOKEN_RESPONSE' } }
        : { ok: true, value: tokens }
    }

    const oauthError = readOAuthError(body)
    if (response.status === 400 && oauthError === 'authorization_pending') {
      consecutiveTransients = 0
      continue
    }
    if (response.status === 400 && oauthError === 'slow_down') {
      consecutiveTransients = 0
      intervalSeconds = backoff(intervalSeconds)
      continue
    }
    if (response.status === 400 && oauthError === 'access_denied') {
      return { ok: false, error: { code: 'AUTHORIZATION_DENIED' } }
    }
    if (response.status === 400 && oauthError === 'expired_token') {
      return { ok: false, error: { code: 'AUTHORIZATION_EXPIRED' } }
    }

    const transient = classifyTransientStatus(response.status)
    if (transient !== undefined) {
      consecutiveTransients++
      if (consecutiveTransients >= MAX_CONSECUTIVE_TRANSIENTS) {
        return {
          ok: false,
          error: { code: 'POLLING_UNAVAILABLE', reason: transient, status: response.status },
        }
      }
      intervalSeconds = backoff(intervalSeconds)
      continue
    }

    return {
      ok: false,
      error: { code: 'POLLING_UNAVAILABLE', reason: 'unexpected-response', status: response.status },
    }
  }

  return { ok: false, error: { code: 'POLLING_UNAVAILABLE', reason: 'unexpected-response' } }
}

/** One refresh exchange. Retry policy and the 25-second replay window belong to the caller. */
export async function refreshDeviceTokens(
  config: Readonly<CliAuthConfig>,
  refreshToken: string,
  dependencies: DeviceAuthDependencies = {},
): Promise<RefreshDeviceTokensResult> {
  if (!isValidConfig(config)) return { ok: false, error: { code: 'INVALID_AUTH_CONFIG' } }
  if (!isBoundedTrimmedString(refreshToken, MAX_TOKEN_LENGTH)) {
    return { ok: false, error: { code: 'INVALID_REFRESH_TOKEN' } }
  }
  if (dependencies.signal?.aborted) {
    return { ok: false, error: { code: 'CANCELLED', attempted: false } }
  }

  const dispatched = await dispatchForm(
    config.tokenEndpoint,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
    }),
    dependencies,
  )
  if (!dispatched.ok) {
    if (dispatched.failure.kind === 'cancelled' && !dispatched.failure.attempted) {
      return { ok: false, error: { code: 'CANCELLED', attempted: false } }
    }
    return {
      ok: false,
      error: {
        code: 'REFRESH_TRANSIENT',
        reason: dispatched.failure.kind === 'cancelled' ? 'cancelled' : dispatched.failure.kind,
        attempted: true,
      },
    }
  }

  const response = dispatched.response
  const body = dispatched.body
  if (response.ok) {
    const tokens = validateTokenResponse(body, config, now(dependencies))
    return tokens === undefined
      ? {
          ok: false,
          error: { code: 'REFRESH_UNCERTAIN', reason: 'malformed-success', attempted: true },
        }
      : { ok: true, value: tokens }
  }

  if (response.status === 400 && readOAuthError(body) === 'invalid_grant') {
    return { ok: false, error: { code: 'REAUTHENTICATION_REQUIRED' } }
  }

  const transient = classifyTransientStatus(response.status)
  if (transient !== undefined) {
    return {
      ok: false,
      error: { code: 'REFRESH_TRANSIENT', reason: transient, attempted: true, status: response.status },
    }
  }
  return {
    ok: false,
    error: {
      code: 'REFRESH_UNCERTAIN',
      reason: 'unexpected-response',
      attempted: true,
      status: response.status,
    },
  }
}

async function dispatchForm(
  endpoint: string,
  body: URLSearchParams,
  dependencies: DeviceAuthDependencies,
  timeoutMs = requestTimeout(dependencies),
): Promise<DispatchResult> {
  if (dependencies.signal?.aborted) {
    return { ok: false, failure: { kind: 'cancelled', attempted: false } }
  }

  const controller = new AbortController()
  const signal = controller.signal
  const cancel = () => controller.abort(dependencies.signal?.reason)
  dependencies.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(
    () => controller.abort(new DOMException('request deadline expired', 'TimeoutError')),
    Math.max(1, timeoutMs),
  )
  const request = new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'error',
    credentials: 'omit',
    signal,
  })
  try {
    const pending = (dependencies.fetch ?? globalThis.fetch)(request, {
      redirect: 'error',
      credentials: 'omit',
      signal,
    }).then((response) => {
      if (signal.aborted) void response.body?.cancel().catch(() => {})
      return response
    })
    const response = await untilAborted(pending, signal)
    const read = await readJson(response, signal, dependencies.signal)
    if (!read.ok && read.kind !== 'malformed') {
      return { ok: false, failure: { kind: read.kind, attempted: true } }
    }
    return { ok: true, response, body: read.ok ? read.value : undefined }
  } catch (error) {
    const kind = dependencies.signal?.aborted
      ? 'cancelled'
      : signal.aborted
        ? 'timeout'
        : isAbortError(error)
          ? 'cancelled'
          : timeoutOrNetwork(error)
    return { ok: false, failure: { kind, attempted: true } }
  } finally {
    clearTimeout(timer)
    dependencies.signal?.removeEventListener('abort', cancel)
  }
}

/** Race even injected transports/readers that do not honor the request signal. */
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

function validateChallengeResponse(
  value: unknown,
  config: Readonly<CliAuthConfig>,
  currentTime: number,
): Readonly<DeviceAuthorizationChallenge> | undefined {
  if (!isRecord(value)) return undefined
  const interval = value.interval === undefined ? MIN_POLL_INTERVAL_SECONDS : value.interval
  if (
    !isBoundedTrimmedString(value.device_code, MAX_DEVICE_CODE_LENGTH) ||
    !isBoundedTrimmedString(value.user_code, MAX_USER_CODE_LENGTH) ||
    !isPositiveBoundedInteger(value.expires_in, MAX_CHALLENGE_LIFETIME_SECONDS) ||
    !isPositiveBoundedInteger(interval, MAX_POLL_INTERVAL_SECONDS) ||
    typeof value.verification_uri !== 'string' ||
    typeof value.verification_uri_complete !== 'string'
  ) {
    return undefined
  }

  const expectedUri = `${config.verificationOrigin}/device`
  const expectedComplete = `${expectedUri}?${new URLSearchParams({ user_code: value.user_code })}`
  if (value.verification_uri !== expectedUri || value.verification_uri_complete !== expectedComplete) return undefined

  return Object.freeze({
    display: Object.freeze({
      userCode: value.user_code,
      verificationUri: value.verification_uri,
      verificationUriComplete: value.verification_uri_complete,
    }),
    secret: Object.freeze({ deviceCode: value.device_code }),
    expiresAt: currentTime + value.expires_in * 1_000,
    intervalSeconds: Math.max(MIN_POLL_INTERVAL_SECONDS, interval),
  })
}

function isValidChallenge(
  challenge: Readonly<DeviceAuthorizationChallenge>,
  config: Readonly<CliAuthConfig>,
  currentTime: number,
): boolean {
  if (
    !isRecord(challenge) ||
    !isRecord(challenge.display) ||
    !isRecord(challenge.secret) ||
    !isBoundedTrimmedString(challenge.secret.deviceCode, MAX_DEVICE_CODE_LENGTH) ||
    !isBoundedTrimmedString(challenge.display.userCode, MAX_USER_CODE_LENGTH) ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= 0 ||
    challenge.expiresAt > currentTime + MAX_CHALLENGE_LIFETIME_SECONDS * 1_000 ||
    !Number.isSafeInteger(challenge.intervalSeconds) ||
    challenge.intervalSeconds < MIN_POLL_INTERVAL_SECONDS ||
    challenge.intervalSeconds > MAX_POLL_INTERVAL_SECONDS
  ) {
    return false
  }
  const expectedUri = `${config.verificationOrigin}/device`
  const expectedComplete = `${expectedUri}?${new URLSearchParams({ user_code: challenge.display.userCode })}`
  return (
    challenge.display.verificationUri === expectedUri && challenge.display.verificationUriComplete === expectedComplete
  )
}

function validateTokenResponse(
  value: unknown,
  config: Readonly<CliAuthConfig>,
  currentTime: number,
): Readonly<DeviceTokenPair> | undefined {
  if (
    !isRecord(value) ||
    !isBoundedTrimmedString(value.access_token, MAX_TOKEN_LENGTH) ||
    !isBoundedTrimmedString(value.refresh_token, MAX_TOKEN_LENGTH)
  ) {
    return undefined
  }

  const metadata = decodeUntrustedMetadata(value.access_token, config, currentTime)
  if (metadata === undefined) return undefined
  return Object.freeze({
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    untrustedMetadata: metadata,
  })
}

function decodeUntrustedMetadata(
  token: string,
  config: Readonly<CliAuthConfig>,
  currentTime: number,
): Readonly<UntrustedAccessTokenMetadata> | undefined {
  const segments = token.split('.')
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0 || !/^[A-Za-z0-9_-]+$/.test(segment))) {
    return undefined
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(segments[1] ?? '', 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(payload)) return undefined

  const { exp, iss, client_id: clientId, sub, sid, auth_time: authTime } = payload
  if (
    !isPositiveBoundedInteger(exp, MAX_SAFE_UNIX_SECONDS) ||
    exp * 1_000 <= currentTime ||
    iss !== config.issuer ||
    clientId !== config.clientId ||
    !isBoundedTrimmedString(sub, MAX_CLAIM_LENGTH) ||
    !isBoundedTrimmedString(sid, MAX_CLAIM_LENGTH) ||
    !isPositiveBoundedInteger(authTime, MAX_SAFE_UNIX_SECONDS) ||
    authTime * 1_000 - currentTime > AUTH_TIME_CLOCK_SKEW_MS
  ) {
    return undefined
  }

  return Object.freeze({
    trust: 'untrusted',
    expiresAt: exp * 1_000,
    issuer: iss,
    clientId,
    subject: sub,
    sessionId: sid,
    authTime,
  })
}

function isValidConfig(config: Readonly<CliAuthConfig>): boolean {
  if (
    config.provider !== 'workos' ||
    !isBoundedTrimmedString(config.clientId, MAX_CLIENT_ID_LENGTH) ||
    config.issuer !== `https://api.workos.com/user_management/${config.clientId}` ||
    config.authorizationEndpoint !== AUTHORIZATION_ENDPOINT ||
    config.tokenEndpoint !== TOKEN_ENDPOINT
  ) {
    return false
  }
  try {
    const verification = new URL(config.verificationOrigin)
    return (
      verification.protocol === 'https:' &&
      verification.origin === config.verificationOrigin &&
      verification.pathname === '/' &&
      verification.search.length === 0 &&
      verification.hash.length === 0 &&
      verification.username.length === 0 &&
      verification.password.length === 0
    )
  } catch {
    return false
  }
}

async function readJson(response: Response, signal: AbortSignal, callerSignal?: AbortSignal): Promise<JsonReadResult> {
  if (response.body === null) return { ok: false, kind: 'malformed' }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let complete = false
  try {
    while (true) {
      const chunk = await untilAborted(reader.read(), signal)
      if (chunk.done) {
        complete = true
        break
      }
      totalBytes += chunk.value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) return { ok: false, kind: 'malformed' }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    } catch {
      return { ok: false, kind: 'malformed' }
    }
  } catch (error) {
    const kind = callerSignal?.aborted
      ? 'cancelled'
      : signal.aborted
        ? 'timeout'
        : isAbortError(error)
          ? 'cancelled'
          : timeoutOrNetwork(error)
    return { ok: false, kind }
  } finally {
    // Cancel without waiting for a provider's underlying cancellation promise.
    if (!complete) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function readOAuthError(value: unknown): string | undefined {
  return isRecord(value) && typeof value.error === 'string' ? value.error : undefined
}

function classifyTransientStatus(status: number): 'timeout' | 'rate-limited' | 'server' | undefined {
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate-limited'
  if (status === 500 || status === 502 || status === 503 || status === 504) return 'server'
  return undefined
}

function backoff(intervalSeconds: number): number {
  return intervalSeconds + MIN_POLL_INTERVAL_SECONDS
}

function now(dependencies: DeviceAuthDependencies): number {
  return Math.floor((dependencies.now ?? Date.now)())
}

function requestTimeout(dependencies: DeviceAuthDependencies): number {
  const timeout = dependencies.requestTimeoutMs
  if (timeout === undefined || !Number.isFinite(timeout)) return DEFAULT_REQUEST_TIMEOUT_MS
  return Math.max(1, Math.min(Math.floor(timeout), MAX_REQUEST_TIMEOUT_MS))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedTrimmedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value
}

function isPositiveBoundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function timeoutOrNetwork(error: unknown): 'timeout' | 'network' {
  return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    function abort() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
