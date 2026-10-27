import type { LatestVersionResult, SelfUpdateErrorEvent, SelfUpdateStatusEvent } from '@agent-facets/engine'

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

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
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
    case 'mise-guidance':
      return (
        `mise manages this facet binary, but its installation could not be safely updated automatically (${event.reason}).\n` +
        `  → update the facet entry in your existing mise configuration manually.\n`
      )
    case 'homebrew-guidance':
      return (
        `Homebrew may manage this facet binary, but its owning formula could not be verified (${event.reason}).\n` +
        `  → inspect it with \`brew which-formula ${quoteShellArgument(event.executable)}\` before updating.\n`
      )
    case 'homebrew-version-unsupported':
      return `Homebrew cannot install the requested Facet version (${event.requestedVersion}) with \`facet self-update --version\`.\n`
  }
}

/** Render structured self-update status data to stdout. */
export function formatSelfUpdateStatus(event: SelfUpdateStatusEvent): string {
  switch (event.kind) {
    case 'homebrew-update-guidance':
      return event.dryRun
        ? 'Homebrew manages this facet binary.\nWould run:\n  brew update\n  brew upgrade agent-facets/tap/facet\n'
        : 'Homebrew manages this facet binary. No update was performed.\nRun:\n  brew update\n  brew upgrade agent-facets/tap/facet\n'
  }
}
