import type { LatestVersionResult, SelfUpdateErrorEvent } from '@agent-facets/engine'

/**
 * Format a `getLatestVersion` failure into the canonical two-line error
 * block this CLI has used since v0:
 *
 *   failed to fetch latest agent-facets version from <url>: <reason>
 *     → check your network connection or set FACET_CLI_REGISTRY to a reachable mirror
 *
 * Engine returns structured failure data; this function is the CLI's
 * sole rendering point for that data. New `LatestVersionResult` failure
 * variants force this switch to update (compile-time obligation), which
 * is the whole reason for the discriminator instead of a free-form
 * string channel.
 */
export function formatLatestVersionFailure(failure: Extract<LatestVersionResult, { ok: false }>): string {
  const reason = describeReason(failure)
  return (
    `failed to fetch latest agent-facets version from ${failure.url}: ${reason}\n` +
    `  → check your network connection or set FACET_CLI_REGISTRY to a reachable mirror\n`
  )
}

function describeReason(failure: Extract<LatestVersionResult, { ok: false }>): string {
  switch (failure.reason) {
    case 'network':
      return `network error: ${failure.cause}`
    case 'http':
      return `HTTP ${failure.status}`
    case 'invalid-json':
      return 'response was not valid JSON'
    case 'missing-version':
      return 'response did not include a "version" field'
  }
}

/**
 * Render a `SelfUpdateErrorEvent` into a stderr line. Wired into
 * `selfUpdateCommand.run`'s `onError` callback so the CLI exhaustively
 * handles every event kind engine can emit.
 *
 *   - `message` — preformatted line, write through unchanged.
 *   - `latest-version-failure` — structured failure, route through
 *     `formatLatestVersionFailure`.
 */
export function formatSelfUpdateError(event: SelfUpdateErrorEvent): string {
  switch (event.kind) {
    case 'message':
      return event.line
    case 'latest-version-failure':
      return formatLatestVersionFailure(event.failure)
  }
}
