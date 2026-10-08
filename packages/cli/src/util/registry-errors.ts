import type { RegistryError, RegistrySessionFailure } from '@agent-facets/engine'
import { archiveCompatibilityGuidance } from './archive-compatibility.ts'
import type { CliError } from './errors.ts'

/**
 * Translate the engine's discriminated `RegistryError` into the CLI's
 * user-facing `CliError` 3-or-4-line stderr block.
 *
 * The CLI is **registry-dumb** for registry-originated errors: when the
 * registry returns a structured envelope, the user sees the registry's
 * own `error` and `fix` text verbatim. The CLI maintains no local
 * code-to-message map — the registry is the single source of truth for
 * what an error means and how to fix it (see design D4).
 *
 * The CLI authors its own text in only two situations, neither of which
 * is a registry-returned error code:
 *
 *   - `UNPARSEABLE_RESPONSE` — the registry replied with something that
 *     is not a valid structured envelope (HTML 502, empty 503, raw
 *     text). There is no server text to render, so the CLI states
 *     plainly that it could not process the response and directs the
 *     user nowhere (no docs link).
 *   - `NOT_FOUND` / `NETWORK_ERROR` / `UNEXPECTED_ERROR` — pre-flight
 *     and transport outcomes the registry never describes in an
 *     envelope. The CLI authors these messages.
 *   - `AUTHENTICATION_ERROR` — local credential and session outcomes. Only
 *     fixed CLI guidance is rendered; nested diagnostics are never printed.
 */
export function translateEngineRegistryError(err: RegistryError): CliError {
  switch (err.code) {
    case 'REGISTRY_REJECTED':
      // Registry-originated structured error: render the server's own
      // strings verbatim. No local map, no synthesized docs link.
      return {
        what: err.error,
        fix: err.fix,
        docsUrl: err.docsUrl,
      }
    case 'UNPARSEABLE_RESPONSE':
      return {
        what: `the registry returned a response the CLI could not process (HTTP ${err.status})`,
        fix: 'try again in a moment; if it persists, the registry may be having trouble',
      }
    case 'NOT_FOUND':
      return {
        what: `facet "${err.name}@${err.spec}" not found in registry`,
        fix: "try 'facet search <term>' to find available facets",
      }
    case 'NETWORK_ERROR':
      return {
        what: 'could not reach the registry',
        detail: err.attempts > 1 ? `${err.cause} (after ${err.attempts} attempts)` : err.cause,
        fix: 'check your network connection and try again',
      }
    case 'UNEXPECTED_ERROR':
      return {
        what: 'unexpected error talking to the registry',
        detail: err.cause,
        fix: 'try again; if persistent, file a bug',
      }
    case 'AUTHENTICATION_ERROR':
      return translateAuthenticationFailure(err.reason)
    case 'TOO_MANY_SPECIFIERS':
      // Not something the registry said, and not something the user did:
      // a command asked for more lookups in one call than the batch
      // boundary accepts. Say so plainly rather than dressing it up as a
      // registry problem the user could act on.
      return {
        what: 'the CLI asked the registry to resolve too many facets at once',
        detail: `${err.received} versions requested in one call (limit ${err.limit})`,
        fix: 'file a bug — this is a defect in the CLI, not your project',
      }
    case 'UNSUPPORTED_ARCHIVE':
      // The single compatibility table names the minimum supporting release
      // for a known newer format, or advises updating to latest for an
      // unknown future one (design D4, task 9.8).
      return archiveCompatibilityGuidance(
        err.observed === undefined ? undefined : String(err.observed),
        err.supported.map(String),
      )
  }
}

function translateAuthenticationFailure(reason: RegistrySessionFailure): CliError {
  switch (reason.code) {
    case 'PAT_UNREADABLE':
      return {
        what: 'saved registry token cannot be read',
        fix: 'check local credential file permissions, then try again',
      }
    case 'UNSUPPORTED_PLATFORM':
      return {
        what: 'browser sign-in is unavailable on this platform',
        fix: 'set FACET_TOKEN or sign in with a personal access token',
      }
    case 'INVALID_REGISTRY_ORIGIN':
      return {
        what: 'registry URL is invalid',
        fix: 'set FACET_REGISTRY_URL to a valid HTTPS registry origin, then try again',
      }
    case 'CONFIG_UNAVAILABLE':
      return {
        what: 'browser sign-in configuration is unavailable',
        fix: 'check registry reachability and try signing in again',
      }
    case 'STATE_UNAVAILABLE':
      return {
        what: 'local sign-in state could not be read or updated',
        fix: 'check local state ownership and permissions, then try again',
      }
    case 'DEVICE_AUTH_FAILED':
      return {
        what: 'browser sign-in did not complete',
        fix: 'start browser sign-in again and complete the verification prompt',
      }
    case 'REGISTRY_VERIFICATION_FAILED':
      return {
        what: 'the registry could not verify this sign-in',
        fix: 'check registry reachability and sign in again',
      }
    case 'ONBOARDING_REQUIRED': {
      const onboardingUrl = safeOnboardingUrl(reason.onboardingUrl)
      return {
        what: 'registry account setup is required',
        fix:
          onboardingUrl === undefined
            ? 'open your registry onboarding page, then sign in again'
            : `open ${onboardingUrl} to finish setup, then sign in again`,
      }
    }
    case 'IDENTITY_MISMATCH':
      return {
        what: 'saved sign-in no longer matches the registry account',
        fix: 'sign out locally and sign in again with the intended account',
      }
    case 'SESSION_CHANGED':
      return {
        what: 'sign-in changed while this command was running',
        fix: 'retry the command with the current session',
      }
    case 'REAUTHENTICATION_REQUIRED':
      return {
        what: 'registry sign-in has expired',
        fix: 'sign in through your browser again',
      }
    case 'REFRESH_UNAVAILABLE':
      return {
        what: 'registry sign-in could not be renewed safely',
        fix:
          reason.reason === 'stale-window'
            ? 'sign in through your browser again to restore access'
            : 'retry the command; if renewal remains unavailable, sign in through your browser again',
      }
    case 'LOGOUT_UNAVAILABLE':
      return {
        what: 'registry could not confirm sign-out',
        fix: 'retry sign-out, or choose local-only sign-out and treat remote revocation as unverified',
      }
    case 'CANCELLED':
      return {
        what: 'authentication was cancelled',
        fix: 'retry the command when ready',
      }
    case 'UNEXPECTED_FAILURE':
      return {
        what: 'local authentication failed unexpectedly',
        fix: 'retry; if the problem persists, report a bug',
      }
    default: {
      const exhaustive: never = reason
      return exhaustive
    }
  }
}

function safeOnboardingUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/auth/onboarding' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.href !== raw
    )
      return undefined
    return url.href
  } catch {
    return undefined
  }
}
