import type { RegistryError } from '@agent-facets/engine'
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
  }
}
