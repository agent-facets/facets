import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fixtures, type WirePackageListItem } from '@agent-facets/engine'
import { render as inkRender } from 'ink-testing-library'
import { createElement } from 'react'
import { captureStderr } from '../../../__tests__/helpers/capture-std.ts'
import { contentFrame, visibleContentFrame, visibleTerminalText } from '../../../__tests__/helpers/terminal-output.ts'
import { type SearchResult, SearchView } from '../../../tui/views/search/search-view.tsx'
import { searchCommand } from '../index.ts'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = process.env.FACET_REGISTRY_URL

beforeEach(() => {
  process.env.FACET_REGISTRY_URL = 'https://api.test'
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  if (ORIGINAL_ENV === undefined) delete process.env.FACET_REGISTRY_URL
  else process.env.FACET_REGISTRY_URL = ORIGINAL_ENV
})

/** Build a fetch function that resolves with the given items. */
function mockFetch(items: WirePackageListItem[]): () => Promise<SearchResult> {
  return async () => ({ ok: true, facets: items })
}

/** Wait for async effects to settle. */
const settle = () => new Promise((r) => setTimeout(r, 100))

/** The visible text of the last frame that rendered anything. */
function lastContentFrame(instance: ReturnType<typeof inkRender>): string {
  return visibleContentFrame(instance.frames)
}

describe('SearchView — rendering', () => {
  test('shows loading animation before results arrive', () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: 'cowsay',
        fetch: () => new Promise<SearchResult>(() => {}), // never resolves
        onComplete: () => {},
      }),
    )
    const f = visibleTerminalText(instance.lastFrame() ?? '')
    expect(f).toContain("Searching registry for 'cowsay'")
    instance.unmount()
  })

  test('empty registry: shows "found no matches"', async () => {
    const instance = inkRender(
      createElement(SearchView, { term: undefined, fetch: mockFetch([]), onComplete: () => {} }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('found no matches')
  })

  test('no match for term: server returns empty, shows "found no matches"', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: 'xyz-not-there',
        fetch: mockFetch([]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('found no matches')
  })

  test('single result: renders name, version, publisher, and header', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: undefined,
        fetch: mockFetch([fixtures.facetSummary({ latest_version: '0.1.0', publisher: 'acme' })]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('cowsay')
    expect(f).toContain('v0.1.0')
    expect(f).toContain('acme')
    expect(f).toContain('found 1 match.')
  })

  test('author preferred over publisher when present', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: undefined,
        fetch: mockFetch([fixtures.facetSummary({ latest_version: '0.1.0', author: 'jane', publisher: 'acme-org' })]),
        onComplete: () => {},
      }),
    )
    await settle()
    expect(lastContentFrame(instance)).toContain('jane')
  })

  test('multiple results with header count', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: 'cow',
        fetch: mockFetch([
          fixtures.facetSummary({ latest_version: '0.1.0' }),
          fixtures.facetSummary({ name: 'mooing-cow', latest_version: '0.2.0' }),
        ]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('cowsay')
    expect(f).toContain('mooing-cow')
    expect(f).toContain('found 2 matches.')
  })

  test('renders whatever the server returned (no client-side filtering)', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: 'camel',
        fetch: mockFetch([fixtures.facetSummary({ name: 'CamelCaseName', latest_version: '1.0.0' })]),
        onComplete: () => {},
      }),
    )
    await settle()
    expect(lastContentFrame(instance)).toContain('CamelCaseName')
  })

  test('no-args lists everything', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: undefined,
        fetch: mockFetch([
          fixtures.facetSummary({ name: 'a', latest_version: '1.0.0' }),
          fixtures.facetSummary({ name: 'b', latest_version: '2.0.0' }),
        ]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('a')
    expect(f).toContain('b')
  })
})

describe('SearchView — D10: assetCounts rendering', () => {
  test('multi-kind: renders pluralized summary', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: undefined,
        fetch: mockFetch([
          fixtures.facetSummary({
            name: 'multi',
            latest_version: '1.0.0',
            asset_counts: { agents: 1, commands: 2, servers: 1, skills: 0 },
          }),
        ]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('1 agent')
    expect(f).toContain('2 commands')
    expect(f).toContain('1 server')
    expect(f).not.toContain('skill')
  })

  test('single-kind: renders only the non-zero kind', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: undefined,
        fetch: mockFetch([
          fixtures.facetSummary({
            name: 'commands-only',
            latest_version: '1.0.0',
            asset_counts: { agents: 0, commands: 2, servers: 0, skills: 0 },
          }),
        ]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('2 commands')
    expect(f).not.toContain('0 agent')
  })

  test('all-zero: no asset counts rendered', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: undefined,
        fetch: mockFetch([fixtures.facetSummary({ name: 'empty', latest_version: '1.0.0' })]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('empty')
    expect(f).toContain('v1.0.0')
    // A count and its noun render on one row, so this reads the frame with
    // its rows intact — unwrapped, `\s+` would span two rows and could match
    // text that never appeared together.
    expect(contentFrame(instance.frames)).not.toMatch(/\d+\s+(agent|command|server|skill)/)
  })
})

describe('searchCommand — error paths', () => {
  test('network failure: writes a CliError and returns 1', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('could not reach the registry')
    expect(stderr).not.toContain('docs:')
  })

  test('server returns structured error envelope: renders the server text verbatim', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify(
          fixtures.apiError({
            code: 'E_REGISTRY_UNAVAILABLE',
            error: 'whoops',
            fix: 'try again shortly',
            docs_url: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
          }),
        ),
        { status: 503, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('whoops')
    expect(stderr).toContain('try again shortly')
    expect(stderr).toContain('https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE')
  })

  test('rejects more than one positional arg', async () => {
    const { result, stderr } = await captureStderr(() => searchCommand.run(['a', 'b'], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('at most one argument')
  })

  test('unexpected response shape: clean error pointing at self-update', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('unexpected shape')
  })
})

describe('searchCommand — query parameter', () => {
  /** Capture the request URL and reply with an empty facet list. */
  function captureRequestUrl(): { urls: string[] } {
    const urls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      urls.push(url)
      return new Response(JSON.stringify({ facets: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return { urls }
  }

  test('sends ?q=<term> when a term is given', async () => {
    const { urls } = captureRequestUrl()
    const { result } = await captureStderr(() => searchCommand.run(['cowsay'], {}))
    expect(result).toBe(0)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('q=cowsay')
  })

  test('omits the q parameter when no term is given', async () => {
    const { urls } = captureRequestUrl()
    const { result } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(0)
    expect(urls).toHaveLength(1)
    expect(urls[0]).not.toContain('q=')
  })
})
