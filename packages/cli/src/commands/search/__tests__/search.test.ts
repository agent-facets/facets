import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { searchCommand } from '../index.ts'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = process.env.FACET_REGISTRY_URL

beforeEach(() => {
  process.env.FACET_REGISTRY_URL = 'https://api.test/v0'
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  if (ORIGINAL_ENV === undefined) delete process.env.FACET_REGISTRY_URL
  else process.env.FACET_REGISTRY_URL = ORIGINAL_ENV
})

function mockPackages(facets: ReadonlyArray<{ name: string; latestVersion: string; publishedAt?: string }>): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        facets: facets.map((f) => ({
          publishedAt: '2026-05-01T00:00:00Z',
          ...f,
        })),
      }),
      { status: 200 },
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

  test('server returns Tier 2 error envelope: translates to a clean CliError', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: 'whoops',
          code: 'E_REGISTRY_UNAVAILABLE',
          docsUrl: 'https://agentfacets.io/errors/E_REGISTRY_UNAVAILABLE',
        }),
        { status: 503 },
      )) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('registry temporarily unavailable')
    expect(stderr).toContain('try again in a moment')
  })

  test('rejects more than one positional arg', async () => {
    const { result, stderr } = await captureStderr(() => searchCommand.run(['a', 'b'], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('at most one argument')
  })

  test('malformed JSON body: clean error', async () => {
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('malformed response')
  })

  test('unexpected response shape: clean error pointing at self-update', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 })) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => searchCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('unexpected shape')
  })
})
