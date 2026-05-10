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
 * Discriminated result for `getLatestVersion`. Every failure mode is part
 * of the function's contract — a CLI doing self-update on a flaky network
 * MUST handle each one, and pure data on the failure arm makes the
 * obligation visible to the type system. Engine returns information; the
 * CLI is responsible for formatting these into user-facing prose.
 */
export type LatestVersionResult =
  | { ok: true; version: string }
  | { ok: false; reason: 'network'; url: string; cause: string }
  | { ok: false; reason: 'http'; url: string; status: number }
  | { ok: false; reason: 'invalid-json'; url: string }
  | { ok: false; reason: 'missing-version'; url: string }

/**
 * Look up the latest published version of `agent-facets` on npm.
 *
 * Honors `FACET_CLI_REGISTRY` so the curl-installer's mirror convention
 * carries over to self-update. Caps each request at 10 seconds via
 * `AbortSignal.timeout` so a hung registry can't stall the CLI
 * indefinitely.
 *
 * Returns a discriminated `LatestVersionResult` — never throws on any
 * documented failure mode. Tests mock `globalThis.fetch` via `spyOn`;
 * this function takes no dependencies of its own.
 */
export async function getLatestVersion(): Promise<LatestVersionResult> {
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
    const cause = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: 'network', url, cause }
  }

  if (!response.ok) {
    return { ok: false, reason: 'http', url, status: response.status }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, reason: 'invalid-json', url }
  }

  if (typeof body !== 'object' || body === null) {
    return { ok: false, reason: 'missing-version', url }
  }
  const version = (body as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') {
    return { ok: false, reason: 'missing-version', url }
  }

  return { ok: true, version }
}
