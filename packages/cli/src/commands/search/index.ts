import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { registryFetch } from '../../util/registry-client.ts'

/**
 * `facet search [term]` — query the registry for facets whose name matches
 * `term` (substring, case-insensitive). With no term, lists every facet
 * the registry returns (capped server-side at LIMIT 200 in V0).
 *
 * Each result shows the canonical name, latest version, and the single
 * copy-paste next step:
 *
 *   - `facet add <name>` — install it
 *
 * We deliberately do NOT suggest a downstream invocation (e.g.,
 * `opencode run --command ...`) because the V0 list endpoint doesn't
 * carry asset metadata: many facets ship arbitrary command names,
 * multiple commands, or no commands at all (skill-only or agent-only).
 * Once the registry returns asset names, we can add a runtime-correct
 * suggestion line back.
 *
 * V0 registry returns `{name, latestVersion, publishedAt}` per result —
 * author/install-count/asset-counts are alpha+. Render gracefully without
 * them; absent fields just don't appear.
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

    const result = await registryFetch('/packages')
    if (!result.ok) {
      writeCliError(result.failure)
      return 1
    }

    let body: unknown
    try {
      body = await result.response.json()
    } catch (err) {
      writeCliError({
        what: 'registry returned a malformed response',
        detail: err instanceof Error ? err.message : String(err),
        fix: 'try again in a moment',
      })
      return 1
    }

    if (!isPackagesResponse(body)) {
      writeCliError({
        what: 'registry returned an unexpected shape',
        detail: 'expected { facets: [{ name, latestVersion, publishedAt }, ...] }',
        fix: "this likely means the CLI is talking to a newer registry — try 'facet self-update'",
      })
      return 1
    }

    const all = body.facets
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

interface RegistryFacetSummary {
  name: string
  latestVersion: string
  publishedAt: string
}

interface PackagesResponse {
  facets: RegistryFacetSummary[]
}

function isPackagesResponse(value: unknown): value is PackagesResponse {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.facets)) return false
  return v.facets.every(
    (f) =>
      f !== null &&
      typeof f === 'object' &&
      typeof (f as Record<string, unknown>).name === 'string' &&
      typeof (f as Record<string, unknown>).latestVersion === 'string' &&
      typeof (f as Record<string, unknown>).publishedAt === 'string',
  )
}

function renderResult(f: RegistryFacetSummary): string {
  const headline = `${f.name}   v${f.latestVersion}`
  return [headline, `  → facet add ${f.name}`].join('\n')
}
