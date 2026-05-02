import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { encodeFacetName, getRegistryBaseUrl, registryFetch } from '../registry-client.ts'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = process.env.FACET_REGISTRY_URL

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  if (ORIGINAL_ENV === undefined) delete process.env.FACET_REGISTRY_URL
  else process.env.FACET_REGISTRY_URL = ORIGINAL_ENV
})

describe('getRegistryBaseUrl', () => {
  test('falls back to the dev stage default when env is unset', () => {
    delete process.env.FACET_REGISTRY_URL
    expect(getRegistryBaseUrl()).toBe('https://api.dev.facet.cafe/v0')
  })

  test('uses FACET_REGISTRY_URL when set', () => {
    process.env.FACET_REGISTRY_URL = 'https://api.example.com/v0'
    expect(getRegistryBaseUrl()).toBe('https://api.example.com/v0')
  })

  test('strips trailing slashes so paths can be appended without doubling', () => {
    process.env.FACET_REGISTRY_URL = 'https://api.example.com/v0///'
    expect(getRegistryBaseUrl()).toBe('https://api.example.com/v0')
  })

  test('treats empty FACET_REGISTRY_URL as unset', () => {
    process.env.FACET_REGISTRY_URL = ''
    expect(getRegistryBaseUrl()).toBe('https://api.dev.facet.cafe/v0')
  })
})

describe('encodeFacetName', () => {
  test('passes bare names through unchanged', () => {
    expect(encodeFacetName('cowsay')).toBe('cowsay')
  })

  test('percent-encodes the slash in namespaced names (npm-style %2F)', () => {
    expect(encodeFacetName('acme/cowsay')).toBe('acme%2Fcowsay')
  })
})

describe('registryFetch', () => {
  beforeEach(() => {
    process.env.FACET_REGISTRY_URL = 'https://api.test/v0'
  })

  test('returns ok=true with the Response on 2xx', async () => {
    let calledUrl = ''
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(input)
      // Inspect init to verify signal was threaded through (timeout wiring).
      expect(init?.signal).toBeDefined()
      return new Response(JSON.stringify({ facets: [] }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await registryFetch('/packages')
    expect(result.ok).toBe(true)
    expect(calledUrl).toBe('https://api.test/v0/packages')
  })

  test('translates a Tier 2 error envelope into a CliError', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: 'facet "missing" not found in registry',
          code: 'E_FACET_NOT_FOUND',
          docsUrl: 'https://agentfacets.io/errors/E_FACET_NOT_FOUND',
        }),
        { status: 404 },
      )) as unknown as typeof fetch
    const result = await registryFetch('/packages/missing/1.0.0')
    if (result.ok) expect.unreachable()
    expect(result.kind).toBe('server-error')
    expect(result.failure.fix).toBe("try 'facet search <term>' to find available facets")
    expect(result.failure.docsUrl).toBe('https://agentfacets.io/errors/E_FACET_NOT_FOUND')
  })

  test('does NOT retry on HTTP error responses (server already answered)', async () => {
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      return new Response(
        JSON.stringify({
          error: 'gone',
          code: 'E_FACET_NOT_FOUND',
          docsUrl: 'https://docs',
        }),
        { status: 404 },
      )
    }) as unknown as typeof fetch
    await registryFetch('/packages/x/1.0.0')
    expect(attempts).toBe(1)
  })

  test('falls back to a generic CliError for non-Tier-2 error bodies (gateway page, etc.)', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as unknown as typeof fetch
    const result = await registryFetch('/packages')
    if (result.ok) expect.unreachable()
    expect(result.kind).toBe('server-error')
    expect(result.failure.what).toContain('unexpected response')
    expect(result.failure.detail).toContain('502')
  })

  test('retries on network failure up to 2 times then fails with a network CliError', async () => {
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const result = await registryFetch('/packages')
    if (result.ok) expect.unreachable()
    expect(attempts).toBe(3) // initial + 2 retries
    expect(result.kind).toBe('network')
    expect(result.failure.fix).toBe('try again in a moment')
  })

  test('succeeds if a retry attempt recovers from a transient network failure', async () => {
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      if (attempts < 2) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ facets: [] }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await registryFetch('/packages')
    expect(result.ok).toBe(true)
    expect(attempts).toBe(2)
  })

  test('appends a leading slash if the path is missing one', async () => {
    let calledUrl = ''
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrl = String(input)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await registryFetch('packages')
    expect(calledUrl).toBe('https://api.test/v0/packages')
  })
})
