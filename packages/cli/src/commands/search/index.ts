import { createRegistryClient, resolveCredential, translateThrownError, translateWireError } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { type SearchResult, SearchView } from '../../tui/views/search/search-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'

/**
 * `facet search [term]` — query the registry's search endpoint for
 * facets matching `term`. The term is sent to the registry as the
 * `?q=` search parameter and the server performs the match; the CLI
 * renders whatever page the registry returns. With no term, lists the
 * facets the registry returns for an unfiltered query (the server owns
 * ordering and paging; this command renders the first page only).
 *
 * Each result shows the canonical name, latest version, author,
 * and a per-asset-type colored count summary in a columnar layout
 * with vertically-aligned `·` separators. An animated "Searching
 * registry for '<term>'" line shows while the fetch is in progress.
 *
 * The wire-shaped types come from `@agent-facets/engine`'s curated
 * re-exports of the registry's published OpenAPI specification —
 * `WirePackageListItem` is the per-result shape.
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
      process.stderr.write(
        `warning: couldn't read credentials at ${cred.reason.path} (${cred.reason.cause}); continuing anonymously\n`,
      )
    }
    const client = createRegistryClient({
      credential: cred.source === 'absent' ? undefined : cred.token,
    })

    // The fetch function is passed to the view so the animated
    // "Searching..." line shows while the request is in flight.
    const fetchResults = async (): Promise<SearchResult> => {
      try {
        const { data, error, response } = await client.GET('/v0/facets', {
          params: term !== undefined ? { query: { q: term } } : {},
        })
        const runtimeError = error as unknown
        if (runtimeError !== undefined) {
          writeCliError(
            translateEngineRegistryError(
              translateWireError(runtimeError as Parameters<typeof translateWireError>[0], response.status),
            ),
          )
          return { ok: false, error: 'handled' }
        }
        if (data === undefined || !Array.isArray((data as { facets?: unknown }).facets)) {
          writeCliError({
            what: 'registry returned an unexpected shape',
            detail: `expected { facets: [...] }`,
            fix: "this likely means the CLI is talking to a newer registry — try 'facet self-update'",
          })
          return { ok: false, error: 'handled' }
        }
        return { ok: true, facets: data.facets }
      } catch (err) {
        writeCliError(translateEngineRegistryError(translateThrownError(err)))
        return { ok: false, error: 'handled' }
      }
    }

    let exitCode = 0
    const instance = render(
      createElement(SearchView, {
        term,
        fetch: fetchResults,
        onComplete: (code: number) => {
          exitCode = code
        },
      }),
    )
    try {
      await instance.waitUntilExit()
    } catch {
      // View exited with an error (fetch failure) — exit code already
      // set by onComplete, and the error was written to stderr by
      // writeCliError before the view received ok:false.
    }
    return exitCode
  },
}
