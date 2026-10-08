import { createHash } from 'node:crypto'
import { lstat, readlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { resolveFacetDir } from '../facet-dir.ts'
import { type CliAuthConfig, type CliConfigFailure, fetchCliAuthConfig, validateRegistryOrigin } from './cli-config.ts'
import { createRegistryClient } from './client.ts'
import { deleteCredentialsFile, resolveCredential } from './credentials.ts'
import {
  type DeviceAuthorizationChallenge,
  type DeviceAuthorizationDisplay,
  type DeviceTokenPair,
  type PollDeviceAuthorizationFailure,
  pollDeviceAuthorization,
  type RequestDeviceAuthorizationFailure,
  refreshDeviceTokens,
  requestDeviceAuthorization,
} from './device-auth.ts'
import { getRegistryBaseUrl } from './http.ts'
import {
  deleteOAuthSession,
  isOAuthStorePlatformSupported,
  type OAuthSession,
  type OAuthSessionBinding,
  type OAuthSessionLock,
  type OAuthStoreError,
  type PendingOAuthSession,
  type ReadyOAuthSession,
  readOAuthSession,
  readOAuthSessionForLocalCleanup,
  readOAuthSessionSnapshot,
  saveOAuthSession,
  type UncertainOAuthSession,
  withOAuthSessionLock,
} from './oauth-store.ts'
import type { WireAuthMeResponse } from './wire.ts'

const REFRESH_AHEAD_MS = 30_000
const REPLAY_WINDOW_MS = 25_000
const MAX_REFRESH_ATTEMPTS = 3
const MAX_REFRESH_REQUEST_MS = 5_000
const LOCK_TIMEOUT_MS = 35_000
const RETRY_BACKOFF_MS: ReadonlyArray<number> = [250, 500]
const UNAVAILABLE_GUIDANCE = 'Browser login is unavailable on this platform; use FACET_TOKEN or PAT login.'

export interface RegistrySessionOptions {
  registryUrl?: string
  allowHttpLoopback?: boolean
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
  platform?: string
}

export type RegistrySessionFailure =
  | { code: 'PAT_UNREADABLE'; path: string }
  | { code: 'UNSUPPORTED_PLATFORM'; guidance: typeof UNAVAILABLE_GUIDANCE }
  | { code: 'INVALID_REGISTRY_ORIGIN' }
  | { code: 'CONFIG_UNAVAILABLE'; reason: CliConfigFailure['code']; status?: number }
  | { code: 'STATE_UNAVAILABLE'; reason: OAuthStoreError['code'] }
  | {
      code: 'DEVICE_AUTH_FAILED'
      reason: RequestDeviceAuthorizationFailure['code'] | PollDeviceAuthorizationFailure['code']
    }
  | { code: 'REGISTRY_VERIFICATION_FAILED'; status?: number }
  | { code: 'ONBOARDING_REQUIRED'; onboardingUrl: string }
  | { code: 'IDENTITY_MISMATCH' }
  | { code: 'SESSION_CHANGED' }
  | { code: 'REAUTHENTICATION_REQUIRED' }
  | { code: 'REFRESH_UNAVAILABLE'; reason: 'transient' | 'uncertain' | 'stale-window' }
  | { code: 'LOGOUT_UNAVAILABLE'; status?: number }
  | { code: 'CANCELLED' }
  | { code: 'UNEXPECTED_FAILURE' }

export type RegistrySessionResult<T> = { ok: true; value: T } | { ok: false; error: RegistrySessionFailure }

export type ResolvedRegistryCredential =
  | { source: 'env' | 'file'; token: string }
  | { source: 'oauth'; token: string; registryOrigin: string; profile: Readonly<WireAuthMeResponse> }
  | { source: 'absent' }

const loginAttempts = new WeakMap<CliLoginAttempt, LoginContext>()
const loginAttemptBrand = Symbol('cli-login-attempt')

export interface CliLoginAttempt {
  readonly display: Readonly<DeviceAuthorizationDisplay>
  readonly expiresAt: number
  readonly [loginAttemptBrand]: true
}

interface LoginContext {
  readonly config: Readonly<CliAuthConfig>
  readonly challenge: Readonly<DeviceAuthorizationChallenge>
  readonly expectedSession: Readonly<OAuthSession> | null
  readonly expectedRevision: number | null
}

export type CliLogoutOutcome =
  | { source: 'pat'; removed: boolean; envActive: boolean }
  | { source: 'oauth'; remoteRevocation: 'confirmed' | 'unverified' }
  | { source: 'absent' }

/** PAT precedence is resolved before any OAuth network or state access. */
export async function resolveRegistryCredential(
  options: RegistrySessionOptions = {},
): Promise<RegistrySessionResult<ResolvedRegistryCredential>> {
  try {
    const legacy = resolveCredential()
    if (legacy.source === 'env' || legacy.source === 'file') return success(legacy)
    if (legacy.reason !== undefined) return failure({ code: 'PAT_UNREADABLE', path: legacy.reason.path })
    if (!isOAuthStorePlatformSupported(options.platform)) return success({ source: 'absent' })
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })

    const selected = selectedOrigin(options)
    if (!selected.ok) {
      const anonymousOrigin = anonymousHttpOrigin(options.registryUrl ?? getRegistryBaseUrl())
      if (anonymousOrigin === undefined) return selected
      const exists = await stateCandidateExists(anonymousOrigin)
      if (!exists.ok) return exists
      return exists.value ? selected : success({ source: 'absent' })
    }
    const exists = await stateCandidateExists(selected.value)
    if (!exists.ok) return exists
    if (!exists.value) return success({ source: 'absent' })
    const candidate = await readOAuthSessionForLocalCleanup(selected.value, { platform: options.platform })
    if (!candidate.ok) return storeFailure(candidate.error)
    if (candidate.value === null) return success({ source: 'absent' })
    const configured = await configuredFor(selected.value, options)
    if (!configured.ok) return configured
    const config = configured.value
    const binding = bindingFor(config)
    return locked<Extract<ResolvedRegistryCredential, { source: 'oauth' }>>(binding, options, async (lock) => {
      const read = await readOAuthSession(binding)
      if (!read.ok) return storeFailure(read.error)
      if (read.value === null) return failure({ code: 'SESSION_CHANGED' })
      return resolveHeld(config, read.value, lock, options)
    })
  } catch {
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    return failure({ code: 'UNEXPECTED_FAILURE' })
  }
}

/** The attempt carries no device secret on its public display surface. */
export async function beginCliLogin(
  options: RegistrySessionOptions = {},
): Promise<RegistrySessionResult<CliLoginAttempt>> {
  try {
    if (!isOAuthStorePlatformSupported(options.platform)) return unsupportedPlatform()
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    const selected = selectedOrigin(options)
    if (!selected.ok) return selected
    const configured = await configuredFor(selected.value, options)
    if (!configured.ok) return configured
    const config = configured.value
    const binding = bindingFor(config)
    const existing = await readOAuthSessionSnapshot(binding)
    if (!existing.ok) return storeFailure(existing.error)
    const requested = await requestDeviceAuthorization(config, deviceOptions(options))
    if (options.signal?.aborted || (!requested.ok && requested.error.code === 'CANCELLED'))
      return failure({ code: 'CANCELLED' })
    if (!requested.ok) return failure({ code: 'DEVICE_AUTH_FAILED', reason: requested.error.code })

    const attempt = Object.freeze({
      display: requested.value.display,
      expiresAt: requested.value.expiresAt,
      [loginAttemptBrand]: true,
    } satisfies CliLoginAttempt)
    loginAttempts.set(attempt, {
      config,
      challenge: requested.value,
      expectedSession: existing.value.session === null ? null : Object.freeze({ ...existing.value.session }),
      expectedRevision: existing.value.revision,
    })
    return success(attempt)
  } catch {
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    return failure({ code: 'UNEXPECTED_FAILURE' })
  }
}

export async function completeCliLogin(
  attempt: CliLoginAttempt,
  options: RegistrySessionOptions = {},
): Promise<RegistrySessionResult<Readonly<WireAuthMeResponse>>> {
  try {
    if (!isOAuthStorePlatformSupported(options.platform)) return unsupportedPlatform()
    const context = loginAttempts.get(attempt)
    if (context === undefined) return failure({ code: 'SESSION_CHANGED' })
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    const polled = await pollDeviceAuthorization(context.config, context.challenge, deviceOptions(options))
    if (options.signal?.aborted || (!polled.ok && polled.error.code === 'CANCELLED'))
      return failure({ code: 'CANCELLED' })
    if (!polled.ok) return failure({ code: 'DEVICE_AUTH_FAILED', reason: polled.error.code })

    const binding = bindingFor(context.config)
    const completed = await locked<Readonly<WireAuthMeResponse>>(binding, options, async (lock) => {
      const snapshot = await readOAuthSessionSnapshot(binding)
      if (!snapshot.ok) return storeFailure(snapshot.error)
      const current = snapshot.value.session
      if (
        snapshot.value.revision !== context.expectedRevision ||
        !sameSessionSnapshot(current, context.expectedSession)
      )
        return failure({ code: 'SESSION_CHANGED' })
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })

      const verified = await verifyProfile(context.config, polled.value.accessToken, options)
      if (!verified.ok) return verified
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
      const next = readySession(binding, polled.value, verified.value.user_uuid, (snapshot.value.revision ?? 0) + 1)
      const saved = await saveOAuthSession(next, context.expectedRevision, lock)
      if (!saved.ok) return storeFailure(saved.error)
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
      return success(verified.value)
    })
    if (completed.ok) loginAttempts.delete(attempt)
    return completed
  } catch {
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    return failure({ code: 'UNEXPECTED_FAILURE' })
  }
}

export async function logoutCliSession(
  options: RegistrySessionOptions & { localOnly?: boolean } = {},
): Promise<RegistrySessionResult<CliLogoutOutcome>> {
  try {
    const legacy = resolveCredential()
    if (legacy.source === 'env' || legacy.source === 'file') {
      return success({ source: 'pat', removed: deleteCredentialsFile(), envActive: legacy.source === 'env' })
    }
    // A broken saved PAT still belongs to local logout before any OAuth selection.
    try {
      if (deleteCredentialsFile()) return success({ source: 'pat', removed: true, envActive: false })
    } catch {
      return legacy.reason !== undefined
        ? failure({ code: 'PAT_UNREADABLE', path: legacy.reason.path })
        : failure({ code: 'UNEXPECTED_FAILURE' })
    }
    if (legacy.reason !== undefined) return failure({ code: 'PAT_UNREADABLE', path: legacy.reason.path })
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    const selected = selectedOrigin(options)
    if (!selected.ok) return selected
    const supported = isOAuthStorePlatformSupported(options.platform)
    const exists = supported
      ? await stateCandidateExists(selected.value)
      : await unsupportedStateCandidateExists(selected.value)
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    if (!exists.ok) return exists
    if (!exists.value) return success({ source: 'absent' })
    if (!supported) return unsupportedPlatform()
    const selectedCandidate = await readOAuthSessionForLocalCleanup(selected.value, { platform: options.platform })
    if (!selectedCandidate.ok) return storeFailure(selectedCandidate.error)
    if (selectedCandidate.value === null) return success({ source: 'absent' })
    const candidateSession = Object.freeze({ ...selectedCandidate.value })
    if (options.localOnly === true) {
      const binding = bindingForSession(candidateSession)
      return locked<CliLogoutOutcome>(binding, options, async (lock) => {
        const current = await readOAuthSessionForLocalCleanup(selected.value, { platform: options.platform })
        if (!current.ok) return storeFailure(current.error)
        if (current.value === null || !sameSelectedSession(current.value, candidateSession))
          return failure({ code: 'SESSION_CHANGED' })
        if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
        const deleted = await deleteOAuthSession(binding, current.value.generation, lock)
        return deleted.ok ? success({ source: 'oauth', remoteRevocation: 'unverified' }) : storeFailure(deleted.error)
      })
    }

    const configured = await configuredFor(selected.value, options)
    if (!configured.ok) return configured
    const config = configured.value
    const binding = bindingFor(config)
    return locked<CliLogoutOutcome>(binding, options, async (lock) => {
      const selectedCurrent = await readOAuthSessionForLocalCleanup(selected.value, { platform: options.platform })
      if (!selectedCurrent.ok) return storeFailure(selectedCurrent.error)
      if (selectedCurrent.value === null || !sameSelectedSession(selectedCurrent.value, candidateSession))
        return failure({ code: 'SESSION_CHANGED' })
      const current = await readOAuthSession(binding)
      if (!current.ok) return storeFailure(current.error)
      if (current.value === null || !sameSelectedSession(current.value, candidateSession))
        return failure({ code: 'SESSION_CHANGED' })
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
      const resolved = await resolveHeld(config, current.value, lock, options)
      if (!resolved.ok) {
        if (resolved.error.code !== 'REGISTRY_VERIFICATION_FAILED' || resolved.error.status !== 401) return resolved
        const revocation = await revokeCliSession(config, current.value.access_token, options)
        if (!revocation.ok) return revocation
        const dead = await readOAuthSession(binding)
        if (!dead.ok) return storeFailure(dead.error)
        if (dead.value === null || !sameSelectedSession(dead.value, candidateSession))
          return failure({ code: 'SESSION_CHANGED' })
        if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
        const deleted = await deleteOAuthSession(binding, dead.value.generation, lock)
        return deleted.ok ? success({ source: 'oauth', remoteRevocation: 'confirmed' }) : storeFailure(deleted.error)
      }
      const latest = await readOAuthSession(binding)
      if (!latest.ok) return storeFailure(latest.error)
      if (latest.value === null || !sameSelectedSession(latest.value, candidateSession))
        return failure({ code: 'SESSION_CHANGED' })
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
      const revoked = await revokeCliSession(config, resolved.value.token, options)
      if (!revoked.ok) return revoked
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
      const deleted = await deleteOAuthSession(binding, latest.value.generation, lock)
      return deleted.ok ? success({ source: 'oauth', remoteRevocation: 'confirmed' }) : storeFailure(deleted.error)
    })
  } catch {
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    return failure({ code: 'UNEXPECTED_FAILURE' })
  }
}

async function resolveHeld(
  config: Readonly<CliAuthConfig>,
  session: OAuthSession,
  lock: OAuthSessionLock,
  options: RegistrySessionOptions,
): Promise<RegistrySessionResult<Extract<ResolvedRegistryCredential, { source: 'oauth' }>>> {
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  if (session.status === 'reauth-required') return failure({ code: 'REAUTHENTICATION_REQUIRED' })
  const currentTime = now(options)
  if (!Number.isSafeInteger(currentTime) || currentTime < 0) return failure({ code: 'UNEXPECTED_FAILURE' })
  if (session.status === 'verification-pending' && session.expires_at > currentTime + REFRESH_AHEAD_MS) {
    return verifyPendingHeld(config, session, lock, options)
  }
  if (session.status === 'ready' && session.expires_at > currentTime + REFRESH_AHEAD_MS) {
    return verifiedExisting(config, session, options)
  }

  const refreshed = await refreshHeld(config, session, lock, options)
  if (refreshed.ok) return refreshed
  if (
    refreshed.error.code === 'REFRESH_UNAVAILABLE' &&
    refreshed.error.reason !== 'stale-window' &&
    session.expires_at > now(options)
  ) {
    return verifiedExisting(config, session, options)
  }
  return refreshed
}

async function verifyPendingHeld(
  config: Readonly<CliAuthConfig>,
  session: PendingOAuthSession,
  lock: OAuthSessionLock,
  options: RegistrySessionOptions,
): Promise<RegistrySessionResult<Extract<ResolvedRegistryCredential, { source: 'oauth' }>>> {
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  const verified = await verifyProfile(config, session.access_token, options)
  if (!verified.ok) return verified
  if (verified.value.user_uuid !== session.user_uuid) return failure({ code: 'IDENTITY_MISMATCH' })
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  if (session.expires_at <= now(options)) return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'transient' })
  const ready: ReadyOAuthSession = { ...baseSession(session), status: 'ready', generation: session.generation + 1 }
  const saved = await saveOAuthSession(ready, session.generation, lock)
  if (!saved.ok) return storeFailure(saved.error)
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  if (ready.expires_at <= now(options)) return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'transient' })
  return success({
    source: 'oauth',
    token: ready.access_token,
    registryOrigin: config.registryOrigin,
    profile: verified.value,
  })
}

async function verifiedExisting(
  config: Readonly<CliAuthConfig>,
  session: OAuthSession,
  options: RegistrySessionOptions,
): Promise<RegistrySessionResult<Extract<ResolvedRegistryCredential, { source: 'oauth' }>>> {
  if (session.expires_at <= now(options)) return failure({ code: 'REAUTHENTICATION_REQUIRED' })
  const verified = await verifyProfile(config, session.access_token, options)
  if (!verified.ok) return verified
  if (verified.value.user_uuid !== session.user_uuid) return failure({ code: 'IDENTITY_MISMATCH' })
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  if (session.expires_at <= now(options)) return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'transient' })
  return success({
    source: 'oauth',
    token: session.access_token,
    registryOrigin: config.registryOrigin,
    profile: verified.value,
  })
}

async function refreshHeld(
  config: Readonly<CliAuthConfig>,
  initial: ReadyOAuthSession | UncertainOAuthSession | PendingOAuthSession,
  lock: OAuthSessionLock,
  options: RegistrySessionOptions,
): Promise<RegistrySessionResult<Extract<ResolvedRegistryCredential, { source: 'oauth' }>>> {
  const binding = bindingFor(config)
  let session: ReadyOAuthSession | UncertainOAuthSession | PendingOAuthSession = initial
  const firstDispatch = session.status === 'uncertain' ? session.refresh_started_at : now(options)
  if (
    session.status === 'uncertain' &&
    (firstDispatch > now(options) ||
      now(options) - firstDispatch >= REPLAY_WINDOW_MS ||
      session.refresh_attempts >= MAX_REFRESH_ATTEMPTS)
  ) {
    return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'stale-window' })
  }

  for (
    let attempt = session.status === 'uncertain' ? session.refresh_attempts + 1 : 1;
    attempt <= MAX_REFRESH_ATTEMPTS;
    attempt++
  ) {
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    const remaining = firstDispatch + REPLAY_WINDOW_MS - now(options)
    if (remaining <= 0) return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'stale-window' })
    const fenced: UncertainOAuthSession = {
      ...baseSession(session),
      status: 'uncertain',
      generation: session.generation + 1,
      refresh_started_at: firstDispatch,
      refresh_attempts: attempt === 1 ? 1 : attempt === 2 ? 2 : 3,
    }
    const savedFence = await saveOAuthSession(fenced, session.generation, lock)
    if (!savedFence.ok) return storeFailure(savedFence.error)
    session = fenced
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    const dispatchRemaining = firstDispatch + REPLAY_WINDOW_MS - now(options)
    if (dispatchRemaining <= 0) return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'stale-window' })
    const exchange = await refreshDeviceTokens(config, session.refresh_token, {
      ...deviceOptions(options),
      requestTimeoutMs: Math.min(MAX_REFRESH_REQUEST_MS, dispatchRemaining),
    })
    if (exchange.ok) {
      const metadata = exchange.value.untrustedMetadata
      if (metadata.subject !== session.subject || metadata.sessionId !== session.session_id) {
        return failure({ code: 'IDENTITY_MISMATCH' })
      }
      const pending: PendingOAuthSession = {
        ...readySession(binding, exchange.value, session.user_uuid, session.generation + 1),
        status: 'verification-pending',
      }
      const saved = await saveOAuthSession(pending, session.generation, lock)
      if (!saved.ok) return storeFailure(saved.error)
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
      return verifyPendingHeld(config, pending, lock, options)
    }
    if (options.signal?.aborted || exchange.error.code === 'CANCELLED') return failure({ code: 'CANCELLED' })
    if (exchange.error.code === 'REAUTHENTICATION_REQUIRED') {
      const next: OAuthSession = {
        ...baseSession(session),
        status: 'reauth-required',
        generation: session.generation + 1,
      }
      const saved = await saveOAuthSession(next, session.generation, lock)
      return saved.ok ? failure({ code: 'REAUTHENTICATION_REQUIRED' }) : storeFailure(saved.error)
    }
    if (exchange.error.code !== 'REFRESH_TRANSIENT') {
      return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'uncertain' })
    }
    if (attempt === MAX_REFRESH_ATTEMPTS) break
    const delay = RETRY_BACKOFF_MS[attempt - 1]
    if (delay === undefined || now(options) + delay >= firstDispatch + REPLAY_WINDOW_MS) break
    try {
      await (options.sleep ?? abortableSleep)(delay, options.signal)
    } catch {
      if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
      return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'transient' })
    }
  }
  return failure({ code: 'REFRESH_UNAVAILABLE', reason: 'transient' })
}

async function verifyProfile(
  config: Readonly<CliAuthConfig>,
  accessToken: string,
  options: RegistrySessionOptions,
): Promise<RegistrySessionResult<Readonly<WireAuthMeResponse>>> {
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  const client = createRegistryClient({
    baseUrl: config.registryOrigin,
    credential: accessToken,
    fetch: createBoundFetch(options.fetch ?? globalThis.fetch),
    timeout: { deadlineMs: MAX_REFRESH_REQUEST_MS },
  })
  try {
    const { data, error, response } = await client.GET('/v0/auth/me', {
      redirect: 'error',
      credentials: 'omit',
      signal: options.signal,
    })
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    if (error !== undefined && isRecord(error) && error.code === 'E_ONBOARDING_REQUIRED') {
      return failure({ code: 'ONBOARDING_REQUIRED', onboardingUrl: config.onboardingUrl })
    }
    if (!response.ok || error !== undefined)
      return failure({ code: 'REGISTRY_VERIFICATION_FAILED', status: response.status })
    if (!isValidProfile(data)) return failure({ code: 'REGISTRY_VERIFICATION_FAILED', status: response.status })
    return success(data)
  } catch {
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    return failure({ code: 'REGISTRY_VERIFICATION_FAILED' })
  }
}

async function revokeCliSession(
  config: Readonly<CliAuthConfig>,
  accessToken: string,
  options: RegistrySessionOptions,
): Promise<RegistrySessionResult<void>> {
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  const client = createRegistryClient({
    baseUrl: config.registryOrigin,
    credential: accessToken,
    fetch: createBoundFetch(options.fetch ?? globalThis.fetch),
    timeout: { deadlineMs: MAX_REFRESH_REQUEST_MS },
  })
  try {
    const { data, error, response } = await client.POST('/v0/auth/cli/logout', {
      redirect: 'error',
      credentials: 'omit',
      signal: options.signal,
    })
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    if (!response.ok || error !== undefined || !isRecord(data) || data.ok !== true) {
      return failure({ code: 'LOGOUT_UNAVAILABLE', status: response.status })
    }
    return success(undefined)
  } catch {
    if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
    return failure({ code: 'LOGOUT_UNAVAILABLE' })
  }
}

function isValidProfile(value: unknown): value is WireAuthMeResponse {
  if (!isRecord(value)) return false
  if (
    !isNonempty(value.user_uuid) ||
    !isNonempty(value.username) ||
    !isNonempty(value.email) ||
    (value.tier !== 'admin' && value.tier !== 'enterprise' && value.tier !== 'free' && value.tier !== 'pro') ||
    typeof value.suspended !== 'boolean' ||
    !isRecord(value.getting_started) ||
    !isRecord(value.startup_experience)
  )
    return false
  if (value.getting_started.kind === 'available') {
    if (typeof value.getting_started.offered !== 'boolean' || typeof value.getting_started.entry_required !== 'boolean')
      return false
    for (const key of [
      'cli_signed_in_at',
      'completed_at',
      'facet_added_at',
      'opted_out_at',
      'presented_at',
      'skipped_at',
      'token_created_at',
    ]) {
      const timestamp = value.getting_started[key]
      if (timestamp !== undefined && typeof timestamp !== 'string') return false
    }
  } else if (value.getting_started.kind !== 'unavailable') return false
  if (value.startup_experience.kind === 'browse-preview') {
    if (
      value.startup_experience.startup_destination !== 'browse' &&
      value.startup_experience.startup_destination !== 'landing' &&
      value.startup_experience.startup_destination !== 'unset'
    )
      return false
  } else if (value.startup_experience.kind !== 'landing-only') return false
  return value.email_invitations_available === undefined || typeof value.email_invitations_available === 'boolean'
}

/** Bun does not reflect RequestInit credentials reliably on Request, so enforce it at fetch. */
function createBoundFetch(fetchImpl: typeof globalThis.fetch): typeof globalThis.fetch {
  const boundFetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const incoming = input instanceof Request ? input : new Request(input.toString(), init)
    const headers = new Headers(incoming.headers)
    headers.delete('cookie')
    const request = new Request(incoming, { headers, redirect: 'error' })
    return fetchImpl(request, { redirect: 'error', credentials: 'omit', signal: request.signal })
  }
  boundFetch.preconnect = fetchImpl.preconnect
  return boundFetch
}

/** HTTP can remain anonymous, but cannot select or configure browser credentials. */
function anonymousHttpOrigin(raw: string): string | undefined {
  if (!/^http:\/\/[^/?#]+\/?$/i.test(raw) || /[\s\\]/.test(raw)) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && url.username === '' && url.password === '' ? url.origin : undefined
  } catch {
    return undefined
  }
}

function selectedOrigin(options: RegistrySessionOptions): RegistrySessionResult<string> {
  const selected = validateRegistryOrigin(options.registryUrl ?? getRegistryBaseUrl(), options.allowHttpLoopback)
  return selected.ok ? success(selected.value) : failure({ code: 'INVALID_REGISTRY_ORIGIN' })
}

async function configuredFor(
  origin: string,
  options: RegistrySessionOptions,
): Promise<RegistrySessionResult<Readonly<CliAuthConfig>>> {
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  const configured = await fetchCliAuthConfig({
    registryUrl: origin,
    allowHttpLoopback: options.allowHttpLoopback,
    fetch: options.fetch,
    signal: options.signal,
  })
  if (options.signal?.aborted) return failure({ code: 'CANCELLED' })
  return configured.ok
    ? success(configured.value)
    : failure({
        code: 'CONFIG_UNAVAILABLE',
        reason: configured.error.code,
        ...('status' in configured.error ? { status: configured.error.status } : {}),
      })
}

async function stateCandidateExists(registryOrigin: string): Promise<RegistrySessionResult<boolean>> {
  const key = createHash('sha256').update(registryOrigin).digest('hex')
  const path = join(resolveFacetDir(), 'oauth', `${key}.json`)
  try {
    const state = await lstat(path)
    return state.isFile() && !state.isSymbolicLink()
      ? success(true)
      : failure({ code: 'STATE_UNAVAILABLE', reason: 'UNSAFE_STATE' })
  } catch (error) {
    return isRecord(error) && error.code === 'ENOENT'
      ? success(false)
      : failure({ code: 'STATE_UNAVAILABLE', reason: 'IO_ERROR' })
  }
}

/** Unsupported platforms may prove absence, but must never open an OAuth credential. */
async function unsupportedStateCandidateExists(registryOrigin: string): Promise<RegistrySessionResult<boolean>> {
  try {
    let facetDir = resolve(resolveFacetDir())
    if (process.platform === 'darwin') {
      for (const alias of ['/tmp', '/var']) {
        if (facetDir !== alias && !facetDir.startsWith(`${alias}/`)) continue
        const metadata = await lstat(alias)
        if (!metadata.isSymbolicLink() || metadata.uid !== 0 || (await readlink(alias)) !== `private${alias}`) {
          return failure({ code: 'STATE_UNAVAILABLE', reason: 'UNSAFE_STATE' })
        }
        facetDir = `/private${facetDir}`
        break
      }
    }
    const key = createHash('sha256').update(registryOrigin).digest('hex')
    const candidate = join(facetDir, 'oauth', `${key}.json`)
    const paths = [candidate]
    let parent = dirname(candidate)
    while (true) {
      paths.unshift(parent)
      const next = dirname(parent)
      if (next === parent) break
      parent = next
    }
    for (const path of paths) {
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || (path === candidate ? !metadata.isFile() : !metadata.isDirectory())) {
        return failure({ code: 'STATE_UNAVAILABLE', reason: 'UNSAFE_STATE' })
      }
    }
    return success(true)
  } catch (error) {
    return isRecord(error) && error.code === 'ENOENT'
      ? success(false)
      : failure({ code: 'STATE_UNAVAILABLE', reason: 'IO_ERROR' })
  }
}

function bindingFor(config: Readonly<CliAuthConfig>): OAuthSessionBinding {
  return {
    registry_origin: config.registryOrigin,
    client_id: config.clientId,
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    verification_origin: config.verificationOrigin,
  }
}

function baseSession(session: OAuthSession): Omit<ReadyOAuthSession, 'status' | 'generation'> {
  return {
    version: 1,
    ...bindingForSession(session),
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    subject: session.subject,
    session_id: session.session_id,
    user_uuid: session.user_uuid,
  }
}

function bindingForSession(session: OAuthSession): OAuthSessionBinding {
  return {
    registry_origin: session.registry_origin,
    client_id: session.client_id,
    issuer: session.issuer,
    authorization_endpoint: session.authorization_endpoint,
    token_endpoint: session.token_endpoint,
    verification_origin: session.verification_origin,
  }
}

/** Renewal may change tokens or generation without changing the selected login. */
function sameSelectedSession(left: Readonly<OAuthSession>, right: Readonly<OAuthSession>): boolean {
  return (
    left.user_uuid === right.user_uuid &&
    left.subject === right.subject &&
    left.session_id === right.session_id &&
    left.registry_origin === right.registry_origin &&
    left.client_id === right.client_id &&
    left.issuer === right.issuer &&
    left.authorization_endpoint === right.authorization_endpoint &&
    left.token_endpoint === right.token_endpoint &&
    left.verification_origin === right.verification_origin
  )
}

function sameSessionSnapshot(left: Readonly<OAuthSession> | null, right: Readonly<OAuthSession> | null): boolean {
  if (left === null || right === null) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function readySession(
  binding: OAuthSessionBinding,
  tokens: Readonly<DeviceTokenPair>,
  userUuid: string,
  generation: number,
): ReadyOAuthSession {
  return {
    version: 1,
    ...binding,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.untrustedMetadata.expiresAt,
    subject: tokens.untrustedMetadata.subject,
    session_id: tokens.untrustedMetadata.sessionId,
    user_uuid: userUuid,
    generation,
    status: 'ready',
  }
}

async function locked<T>(
  binding: OAuthSessionBinding,
  options: RegistrySessionOptions,
  operation: (lock: OAuthSessionLock) => Promise<RegistrySessionResult<T>>,
): Promise<RegistrySessionResult<T>> {
  const result = await withOAuthSessionLock(binding, async (lock) => ({ ok: true, value: await operation(lock) }), {
    platform: options.platform,
    signal: options.signal,
    lockTimeoutMs: LOCK_TIMEOUT_MS,
  })
  return result.ok ? result.value : storeFailure(result.error)
}

function deviceOptions(options: RegistrySessionOptions) {
  return { fetch: options.fetch, now: options.now, sleep: options.sleep, signal: options.signal }
}

function now(options: RegistrySessionOptions): number {
  return Math.floor((options.now ?? Date.now)())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function unsupportedPlatform<T>(): RegistrySessionResult<T> {
  return failure({ code: 'UNSUPPORTED_PLATFORM', guidance: UNAVAILABLE_GUIDANCE })
}

function storeFailure<T>(error: OAuthStoreError): RegistrySessionResult<T> {
  if (error.code === 'CANCELLED') return failure({ code: 'CANCELLED' })
  return failure({ code: 'STATE_UNAVAILABLE', reason: error.code })
}

function success<T>(value: T): RegistrySessionResult<T> {
  return { ok: true, value }
}

function failure<T>(error: RegistrySessionFailure): RegistrySessionResult<T> {
  return { ok: false, error }
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
