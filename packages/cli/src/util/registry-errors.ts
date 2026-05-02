import type { CliError } from './errors.ts'

/**
 * Wire-format error response from the registry API. Every 4xx/5xx from
 * `https://api.facet.cafe/v0/*` returns this shape (Tier 2 error contract,
 * pre-locked in osaka backend `packages/v0/core/src/errors/index.ts`).
 */
export interface RegistryErrorResponse {
  error: string
  code: string
  docsUrl: string
}

/**
 * Canonical registry error codes. Five come from the backend's exhaustive
 * enum; `VERSION_EXISTS` is returned by the publish route on 409 dup but
 * sits outside the backend's E_* prefix because it isn't an "error" in the
 * registry-broken sense — it's a normal "you already published that"
 * response that publish auto-handles.
 */
export type RegistryErrorCode =
  | 'E_FACET_NOT_FOUND'
  | 'E_REGISTRY_UNAVAILABLE'
  | 'E_TARBALL_CORRUPTED'
  | 'E_TARBALL_TOO_LARGE'
  | 'E_API_KEY_MISSING'
  | 'VERSION_EXISTS'

/**
 * Detect the registry error wire shape on an unknown JSON value.
 */
export function isRegistryErrorResponse(value: unknown): value is RegistryErrorResponse {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.error === 'string' && typeof v.code === 'string' && typeof v.docsUrl === 'string'
}

/**
 * Translate a registry error response into the canonical 4-line CliError
 * shape. Centralized so every command (`add`, `search`, `publish`) renders
 * registry failures identically.
 *
 * The server's human `error` message becomes the `detail` line verbatim;
 * the `fix` is derived from the machine `code` so the suggestion stays
 * actionable even if the server's `error` text changes. Unknown codes
 * fall through to a generic "check the docs URL" fix.
 */
export function translateRegistryError(response: RegistryErrorResponse): CliError {
  const what = whatForCode(response.code)
  const fix = fixForCode(response.code)
  return {
    what,
    detail: response.error,
    fix,
    docsUrl: response.docsUrl,
  }
}

function whatForCode(code: string): string {
  switch (code) {
    case 'E_FACET_NOT_FOUND':
      return 'facet not found in registry'
    case 'E_REGISTRY_UNAVAILABLE':
      return 'registry temporarily unavailable'
    case 'E_TARBALL_CORRUPTED':
      return 'facet archive is corrupted'
    case 'E_TARBALL_TOO_LARGE':
      return 'facet archive exceeds size limit'
    case 'E_API_KEY_MISSING':
      return 'registry API key missing or invalid'
    case 'VERSION_EXISTS':
      return 'version already published'
    default:
      return `registry error (${code})`
  }
}

function fixForCode(code: string): string {
  switch (code) {
    case 'E_FACET_NOT_FOUND':
      return "try 'facet search <term>' to find available facets"
    case 'E_REGISTRY_UNAVAILABLE':
      return 'try again in a moment'
    case 'E_TARBALL_CORRUPTED':
      return 'try again; if persistent, check your network'
    case 'E_TARBALL_TOO_LARGE':
      return 'reduce the facet contents below 5 MB or split into multiple facets'
    case 'E_API_KEY_MISSING':
      return 'set FACET_REGISTRY_API_KEY in your environment'
    case 'VERSION_EXISTS':
      return "bump the version in facet.json or use 'facet publish' which auto-bumps"
    default:
      return 'check the docs URL for details'
  }
}
