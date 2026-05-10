import type { RegistryError, WireErrorCode, WireErrorResponse } from '@agent-facets/engine'
import type { CliError } from './errors.ts'

/**
 * Wire-format error response from the registry API. Every 4xx/5xx
 * returns this shape, named `ApiErrorBody` in the OpenAPI spec.
 *
 * Re-exported here under the legacy alias so existing CLI call sites
 * keep compiling during the migration. The canonical name is
 * `WireErrorResponse` from `@agent-facets/engine`.
 */
export type RegistryErrorResponse = WireErrorResponse

/**
 * Canonical registry error codes. Now sourced from the registry's
 * OpenAPI specification rather than hand-authored — adding a new code
 * server-side and regenerating the snapshot picks it up automatically.
 *
 * Re-exported under the legacy alias for the same reason as
 * `RegistryErrorResponse` above.
 */
export type RegistryErrorCode = WireErrorCode

/**
 * Detect the registry error wire shape on an unknown JSON value.
 *
 * Used at the boundary between untyped JSON (`response.json()` returns
 * `unknown`) and our typed surface. Once every call site uses the
 * typed registry client (which deserializes responses into the typed
 * `error` field), this guard becomes dead code and can be removed.
 */
export function isRegistryErrorResponse(value: unknown): value is RegistryErrorResponse {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.error === 'string' && typeof v.code === 'string' && typeof v.docsUrl === 'string'
}

/**
 * Build the canonical docs URL for a registry error code. Centralizes
 * the `https://agentfacets.io/errors/<CODE>` URL template so the
 * pattern lives in one place — adding new codes or moving the docs
 * site is a one-line change.
 *
 * The parameter is widened beyond `WireErrorCode` to accept arbitrary
 * strings because (a) the publish path uses this for its own `404`-ish
 * "no API key" pre-flight error, and (b) keeping the runtime input
 * permissive matches the contract of the wire-side `code` field.
 */
export function docsUrlFor(code: WireErrorCode | (string & {})): string {
  return `https://agentfacets.io/errors/${code}`
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

/**
 * Translate the engine's discriminated `RegistryError` into the CLI's
 * user-facing `CliError`. This is the bridge between engine-side
 * structured errors (returned by the typed client through
 * `translateWireError` / `translateThrownError`) and the canonical
 * 3-or-4-line stderr block the CLI renders.
 *
 * The engine surfaces four discriminator codes; this function chooses
 * the right CLI-side messaging for each:
 *
 *   - `NOT_FOUND` → user typo or stale spec; suggest search.
 *   - `NETWORK_ERROR` → transient transport failure; carries
 *     `attempts` so we can show retry history when it's > 1.
 *   - `REGISTRY_NOT_AVAILABLE` → the registry returned a structured
 *     envelope. Pass through if we can identify the canonical CLI
 *     translation from the wire's `code`; otherwise surface the
 *     wire's strings verbatim.
 *   - `UNEXPECTED_ERROR` → something we didn't anticipate; surface
 *     honestly and ask the user to file a bug.
 *
 * Optional `wireCode` lets call sites that have access to the original
 * wire envelope (e.g., publish, which special-cases `VERSION_EXISTS`)
 * route `REGISTRY_NOT_AVAILABLE` errors through the canonical
 * `whatForCode` / `fixForCode` translations rather than the
 * (possibly less helpful) server-supplied strings.
 */
export function translateEngineRegistryError(err: RegistryError, wireCode?: WireErrorCode): CliError {
  switch (err.code) {
    case 'NOT_FOUND':
      return {
        what: `facet "${err.name}@${err.spec}" not found in registry`,
        fix: "try 'facet search <term>' to find available facets",
        docsUrl: docsUrlFor('E_FACET_NOT_FOUND'),
      }
    case 'NETWORK_ERROR':
      return {
        what: 'registry temporarily unavailable',
        detail: err.attempts > 1 ? `${err.cause} (after ${err.attempts} attempts)` : err.cause,
        fix: 'try again in a moment',
        docsUrl: docsUrlFor('E_REGISTRY_UNAVAILABLE'),
      }
    case 'REGISTRY_NOT_AVAILABLE':
      if (wireCode !== undefined) {
        // Caller supplied the original `code` from the wire envelope;
        // route through the canonical CLI translations. Server's
        // human `error` text becomes `detail`, our canonical
        // `whatForCode`/`fixForCode` produce `what`/`fix`.
        return {
          what: whatForCode(wireCode),
          detail: err.what,
          fix: fixForCode(wireCode),
          docsUrl: docsUrlFor(wireCode),
        }
      }
      // No wire envelope context — pass server's strings through.
      return {
        what: err.what,
        fix: err.fix,
        docsUrl: docsUrlFor('E_REGISTRY_UNAVAILABLE'),
      }
    case 'UNEXPECTED_ERROR':
      return {
        what: 'unexpected error from registry',
        detail: err.cause,
        fix: 'try again; if persistent, file a bug',
        docsUrl: docsUrlFor('E_REGISTRY_UNAVAILABLE'),
      }
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
      return 'bump `version` in facet.json and try again'
    default:
      return 'check the docs URL for details'
  }
}
