import {
  createRegistryClient,
  resolveCredential,
  translateThrownError,
  translateWireError,
  type WireAssetCounts,
  type WirePackageListItem,
} from '@agent-facets/engine'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'

/**
 * `facet search [term]` — query the registry for facets whose name
 * matches `term` (substring, case-insensitive). With no term, lists
 * every facet the registry returns (capped server-side at LIMIT 200
 * in V0).
 *
 * Each result shows the canonical name, latest version, an
 * asset-count summary (per design D10), and the single copy-paste
 * next step:
 *
 *   - `facet add <name>` — install it
 *
 * We deliberately do NOT suggest a downstream invocation (e.g.,
 * `opencode run --command ...`) because the registry returns asset
 * counts (numeric) but not asset names. A runtime-correct invocation
 * suggestion would require a different endpoint.
 *
 * The wire-shaped types come from `@agent-facets/engine`'s curated
 * re-exports of the registry's published OpenAPI specification —
 * `WirePackageListItem` is the per-result shape, `WireAssetCounts`
 * is the kind-by-kind count block.
 */
export const searchCommand: Command = {
  name: 'search',
  description: 'Search the registry for facets',
  usage: '[term]',
  implemented: true,
  run: async (args, _flags) => {
    if (args.length > 1) {
      writeCliError({
        what: `facet search accepts at most one argument (got ${args.length})`,
        fix: "use 'facet search <term>' or 'facet search' to list everything",
      })
      return 1
    }
    const term = args[0]

    // Reads carry the credential opportunistically (see design D3):
    // when one is available it earns the authenticated rate-limit tier;
    // when absent the search proceeds anonymously.
    const cred = resolveCredential()
    if (cred.source === 'absent' && cred.reason?.code === 'unreadable') {
      // A credentials file exists but could not be read. The search can
      // still run anonymously, but warn so the user knows why their
      // saved login is not being used.
      process.stderr.write(
        `warning: couldn't read credentials at ${cred.reason.path} (${cred.reason.cause}); continuing anonymously\n`,
      )
    }
    const client = createRegistryClient({
      credential: cred.source === 'absent' ? undefined : cred.token,
    })
    let facets: ReadonlyArray<WirePackageListItem>
    try {
      const { data, error, response } = await client.GET('/v0/facets', {})
      // Runtime check on `error`: the OpenAPI for `GET /v0/facets`
      // currently declares only a 200 response, which makes
      // `result.error` typed as `never`. A non-2xx with a parseable
      // envelope can still arrive at runtime (the spec is incomplete,
      // not the contract), so we cast through `unknown` to query it
      // without TS treating the comparison as always-false.
      const runtimeError = error as unknown
      if (runtimeError !== undefined) {
        writeCliError(
          translateEngineRegistryError(
            translateWireError(runtimeError as Parameters<typeof translateWireError>[0], response.status),
          ),
        )
        return 1
      }
      // Defensive runtime guard. `openapi-fetch` types `data` per the
      // OpenAPI spec but does not validate the body at runtime — if
      // the registry sends a body that doesn't match the schema, the
      // typed `data.facets` could be `undefined` at runtime even
      // though the type says it's an array.
      if (data === undefined || !Array.isArray((data as { facets?: unknown }).facets)) {
        writeCliError({
          what: 'registry returned an unexpected shape',
          detail: `expected { facets: [...] }`,
          fix: "this likely means the CLI is talking to a newer registry — try 'facet self-update'",
        })
        return 1
      }
      facets = data.facets
    } catch (err) {
      writeCliError(translateEngineRegistryError(translateThrownError(err)))
      return 1
    }

    const all = facets
    const filtered = term !== undefined ? all.filter((f) => f.name.toLowerCase().includes(term.toLowerCase())) : all

    if (all.length === 0) {
      process.stdout.write('No facets in the registry yet.\n')
      return 0
    }
    if (filtered.length === 0) {
      process.stdout.write(`No facets match "${term ?? ''}". Try 'facet search' with no args to list everything.\n`)
      return 0
    }

    const blocks = filtered.map((f) => renderResult(f))
    process.stdout.write(`${blocks.join('\n\n')}\n`)
    return 0
  },
}

/**
 * Render a single search result as a multi-line block. Format:
 *
 *   <name>   v<latestVersion>
 *     <asset-counts summary>      ← omitted entirely if all-zero
 *     → facet add <name>
 *
 * The asset-counts line comes from `formatAssetCounts` and is omitted
 * when every count is zero (per D10's all-zero rule), producing a
 * 2-line block in that edge case.
 */
function renderResult(f: WirePackageListItem): string {
  const headline = `${f.name}   v${f.latestVersion}`
  const counts = formatAssetCounts(f.assetCounts)
  const installLine = `  → facet add ${f.name}`
  return counts === null ? [headline, installLine].join('\n') : [headline, `  ${counts}`, installLine].join('\n')
}

/**
 * Render the `WireAssetCounts` object as a one-line summary like
 * `"1 agent, 2 commands, 1 server"`. Returns null when every count
 * is zero, signaling that the caller should omit the line entirely
 * (per D10).
 *
 * Rules from the design:
 *
 *   - Pluralization: standard English plural (`1 agent` / `2 agents`).
 *   - Zero-suppression: kinds with count 0 are omitted.
 *   - Order: `agents`, `commands`, `servers`, `skills` — wire order.
 *   - All-zero: return null so renderer omits the line.
 */
function formatAssetCounts(counts: WireAssetCounts): string | null {
  // [wire-key, singular, plural] tuples in canonical render order.
  // Hardcoded over generic pluralization because the four kinds are
  // a closed set and a future fifth kind should be a deliberate add
  // here, not a silent default.
  const KINDS: ReadonlyArray<readonly [keyof WireAssetCounts, string, string]> = [
    ['agents', 'agent', 'agents'],
    ['commands', 'command', 'commands'],
    ['servers', 'server', 'servers'],
    ['skills', 'skill', 'skills'],
  ]
  const parts: string[] = []
  for (const [key, singular, plural] of KINDS) {
    const n = counts[key]
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`)
  }
  return parts.length === 0 ? null : parts.join(', ')
}
