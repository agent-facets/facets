import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { render as inkRender } from 'ink-testing-library'
import { createElement } from 'react'
import { captureStderr } from '../../../__tests__/helpers/capture-std.ts'
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

function wireItem(
  name: string,
  latestVersion: string,
  opts?: {
    author?: string
    publisher?: string
    assetCounts?: { agents?: number; commands?: number; servers?: number; skills?: number }
  },
) {
  return {
    name,
    latestVersion,
    publishedAt: '2026-05-01T00:00:00Z',
    publisher: opts?.publisher ?? 'test-publisher',
    author: opts?.author,
    assetCounts: {
      agents: opts?.assetCounts?.agents ?? 0,
      commands: opts?.assetCounts?.commands ?? 0,
      servers: opts?.assetCounts?.servers ?? 0,
      skills: opts?.assetCounts?.skills ?? 0,
    },
  }
}

/** Build a fetch function that resolves with the given items. */
function mockFetch(items: ReturnType<typeof wireItem>[]): () => Promise<SearchResult> {
  return async () => ({ ok: true, facets: items })
}

/** Wait for async effects to settle. */
const settle = () => new Promise((r) => setTimeout(r, 100))

/** Find the last non-empty frame. */
function lastContentFrame(instance: ReturnType<typeof inkRender>): string {
  const frames = [...instance.frames].reverse()
  for (const f of frames) {
    if (f.trim().length > 0) return f
  }
  return instance.lastFrame() ?? ''
}

function _mockPackages(
  facets: ReadonlyArray<{
    name: string
    latestVersion: string
    publishedAt?: string
    publisher?: string
    author?: string
    assetCounts?: { agents?: number; commands?: number; servers?: number; skills?: number }
  }>,
): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        facets: facets.map((f) => ({
          name: f.name,
          latestVersion: f.latestVersion,
          publishedAt: f.publishedAt ?? '2026-05-01T00:00:00Z',
          publisher: f.publisher ?? 'test-publisher',
          author: f.author,
          assetCounts: {
            agents: f.assetCounts?.agents ?? 0,
            commands: f.assetCounts?.commands ?? 0,
            servers: f.assetCounts?.servers ?? 0,
            skills: f.assetCounts?.skills ?? 0,
          },
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch
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
    const f = instance.lastFrame() ?? ''
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

  test('no match for term: shows "found no matches" with hint', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: 'xyz-not-there',
        fetch: mockFetch([wireItem('cowsay', '0.1.0')]),
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
        fetch: mockFetch([wireItem('cowsay', '0.1.0', { publisher: 'acme' })]),
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
        fetch: mockFetch([wireItem('cowsay', '0.1.0', { author: 'jane', publisher: 'acme-org' })]),
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
        fetch: mockFetch([wireItem('cowsay', '0.1.0'), wireItem('mooing-cow', '0.2.0')]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('cowsay')
    expect(f).toContain('mooing-cow')
    expect(f).toContain('found 2 matches.')
  })

  test('case-insensitive substring match', async () => {
    const instance = inkRender(
      createElement(SearchView, {
        term: 'camel',
        fetch: mockFetch([wireItem('CamelCaseName', '1.0.0')]),
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
        fetch: mockFetch([wireItem('a', '1.0.0'), wireItem('b', '2.0.0')]),
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
          wireItem('multi', '1.0.0', { assetCounts: { agents: 1, commands: 2, servers: 1, skills: 0 } }),
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
          wireItem('commands-only', '1.0.0', { assetCounts: { agents: 0, commands: 2, servers: 0, skills: 0 } }),
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
        fetch: mockFetch([
          wireItem('empty', '1.0.0', { assetCounts: { agents: 0, commands: 0, servers: 0, skills: 0 } }),
        ]),
        onComplete: () => {},
      }),
    )
    await settle()
    const f = lastContentFrame(instance)
    expect(f).toContain('empty')
    expect(f).toContain('v1.0.0')
    expect(f).not.toMatch(/\d+\s+(agent|command|server|skill)/)
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
        JSON.stringify({
          error: 'whoops',
          code: 'E_REGISTRY_UNAVAILABLE',
          fix: 'try again shortly',
          docsUrl: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
        }),
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
