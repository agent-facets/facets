/**
 * Resolve the latest published version of the wrapper `agent-facets`
 * package from the npm registry. The wrapper is the release gate (last to
 * publish in the changesets pipeline), so its version is the only reliable
 * "is the new release fully available?" signal — the per-platform
 * `@agent-facets/cli-<target>` packages can lag.
 */

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const PACKAGE = 'agent-facets'
const FETCH_TIMEOUT_MS = 10_000

/**
 * Format a failure as the canonical two-line error message:
 *
 *   failed to fetch latest agent-facets version from <url>: <reason>
 *     → check your network connection or set FACET_CLI_REGISTRY to a reachable mirror
 *
 * The `→` line nudges users toward the most likely fix without dictating a
 * specific cause — the upstream `<reason>` already says what went wrong.
 */
function makeError(url: string, reason: string): Error {
  return new Error(
    `failed to fetch latest agent-facets version from ${url}: ${reason}\n` +
      `  → check your network connection or set FACET_CLI_REGISTRY to a reachable mirror`,
  )
}

/**
 * Look up the latest published version of `agent-facets` on npm.
 *
 * Honors `FACET_CLI_REGISTRY` so the curl-installer's mirror convention
 * carries over to self-update. Caps each request at 10 seconds via
 * `AbortSignal.timeout` so a hung registry can't stall the CLI
 * indefinitely. Throws a clear, single-message Error on every failure
 * path; callers decide how to surface it.
 *
 * Tests mock `globalThis.fetch` via `spyOn`; this function takes no
 * dependencies of its own.
 */
export async function getLatestVersion(): Promise<string> {
  const envRegistry = process.env.FACET_CLI_REGISTRY
  const registry = envRegistry !== undefined && envRegistry !== '' ? envRegistry : DEFAULT_REGISTRY
  const url = `${registry.replace(/\/+$/, '')}/${PACKAGE}/latest`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw makeError(url, `network error: ${message}`)
  }

  if (!response.ok) {
    throw makeError(url, `HTTP ${response.status}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw makeError(url, 'response was not valid JSON')
  }

  if (typeof body !== 'object' || body === null) {
    throw makeError(url, 'response did not include a "version" field')
  }
  const version = (body as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') {
    throw makeError(url, 'response did not include a "version" field')
  }

  return version
}
