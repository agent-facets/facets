import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
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

/**
 * Stub `globalThis.fetch` to return a `SearchResponse`-shaped JSON
 * body for the typed registry client. `assetCounts` defaults to
 * all-zero so tests that don't care about the asset-counts line
 * keep working unchanged (per D10's all-zero rule, the line is
 * omitted entirely when every count is 0).
 */
function mockPackages(
  facets: ReadonlyArray<{
    name: string
    latestVersion: string
    publishedAt?: string
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

describe('searchCommand', () => {
  test('empty registry: prints "no facets in the registry yet"', async () => {
    mockPackages([])
    const { result, stdout } = await captureStdout(() => searchCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('No facets in the registry yet')
  })

  test('single match: renders headline + facet add suggestion', async () => {
    mockPackages([{ name: 'cowsay', latestVersion: '0.1.0' }])
    const { result, stdout } = await captureStdout(() => searchCommand.run(['cow'], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('cowsay   v0.1.0')
    expect(stdout).toContain('→ facet add cowsay')
    // We deliberately do not suggest an `opencode run --command ...` line
    // because the V0 list endpoint doesn't return asset metadata; we'd
    // be guessing the wrong command name for many facets.
    expect(stdout).not.toContain('opencode run')
  })

  test('namespaced name: facet add uses full canonical name', async () => {
    mockPackages([{ name: 'acme/cowsay', latestVersion: '0.1.0' }])
    const { result, stdout } = await captureStdout(() => searchCommand.run(['cow'], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('→ facet add acme/cowsay')
    expect(stdout).not.toContain('opencode run')
  })

  test('multiple matches: blank line between blocks', async () => {
    mockPackages([
      { name: 'cowsay', latestVersion: '0.1.0' },
      { name: 'mooing-cow', latestVersion: '0.2.0' },
    ])
    const { result, stdout } = await captureStdout(() => searchCommand.run(['cow'], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('cowsay')
    expect(stdout).toContain('mooing-cow')
    expect(stdout).toContain('\n\n')
  })

  test('case-insensitive substring match', async () => {
    mockPackages([{ name: 'CamelCaseName', latestVersion: '1.0.0' }])
    const { result, stdout } = await captureStdout(() => searchCommand.run(['camel'], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('CamelCaseName')
  })

  test('no-args lists everything', async () => {
    mockPackages([
      { name: 'a', latestVersion: '1.0.0' },
      { name: 'b', latestVersion: '2.0.0' },
    ])
    const { result, stdout } = await captureStdout(() => searchCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('a')
    expect(stdout).toContain('b')
  })

  test('no match for term: friendly hint pointing back at no-arg search', async () => {
    mockPackages([{ name: 'cowsay', latestVersion: '0.1.0' }])
    const { result, stdout } = await captureStdout(() => searchCommand.run(['xyz-not-there'], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('No facets match "xyz-not-there"')
    expect(stdout).toContain("'facet search' with no args")
  })

  test('network failure: writes a CliError and returns 1', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('registry temporarily unavailable')
    expect(stderr).toContain('docs:')
  })

  test('server returns structured error envelope: translates to a clean CliError', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: 'whoops',
          code: 'E_REGISTRY_UNAVAILABLE',
          docsUrl: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    // The wire envelope's `error` field is "whoops"; translation
    // routes 5xx → REGISTRY_NOT_AVAILABLE → translateEngineRegistryError
    // → CLI's canonical message and fix.
    expect(stderr).toContain('whoops')
  })

  test('rejects more than one positional arg', async () => {
    const { result, stderr } = await captureStderr(() => searchCommand.run(['a', 'b'], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('at most one argument')
  })

  test('unexpected response shape: clean error pointing at self-update', async () => {
    // A 200 with a body that doesn't match the SearchResponse shape:
    // `data.facets` is missing, so the runtime guard triggers.
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

describe('searchCommand — D10: assetCounts rendering', () => {
  test('multi-kind: renders pluralized summary in canonical order', async () => {
    mockPackages([
      {
        name: 'multi',
        latestVersion: '1.0.0',
        assetCounts: { agents: 1, commands: 2, servers: 1, skills: 0 },
      },
    ])
    const { result, stdout } = await captureStdout(() => searchCommand.run([], {}))
    expect(result).toBe(0)
    // Pluralization: `1 agent` (singular), `2 commands` (plural), `1 server` (singular).
    // Order: agents → commands → servers → skills (skills suppressed by zero).
    expect(stdout).toContain('1 agent, 2 commands, 1 server')
    expect(stdout).not.toContain('skill')
  })

  test('single-kind: renders only the non-zero kind', async () => {
    mockPackages([
      {
        name: 'commands-only',
        latestVersion: '1.0.0',
        assetCounts: { agents: 0, commands: 2, servers: 0, skills: 0 },
      },
    ])
    const { result, stdout } = await captureStdout(() => searchCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('2 commands')
    // No zero-count kinds appear in the output anywhere on this line.
    expect(stdout).not.toContain('0 agent')
    expect(stdout).not.toContain('0 server')
    expect(stdout).not.toContain('0 skill')
  })

  test('all-zero: omits the asset-counts line entirely', async () => {
    mockPackages([
      {
        name: 'empty',
        latestVersion: '1.0.0',
        assetCounts: { agents: 0, commands: 0, servers: 0, skills: 0 },
      },
    ])
    const { result, stdout } = await captureStdout(() => searchCommand.run([], {}))
    expect(result).toBe(0)
    // The block has exactly two lines: headline + install hint. The
    // asset-counts line is omitted (no digit followed by `agent` /
    // `command` / `server` / `skill`).
    expect(stdout).not.toMatch(/\d+\s+(agent|command|server|skill)/)
    expect(stdout).toContain('empty   v1.0.0')
    expect(stdout).toContain('→ facet add empty')
  })
})
