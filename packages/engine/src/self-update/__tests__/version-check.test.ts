import { afterAll, afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import { getLatestVersion } from '../version-check.ts'

const ORIGINAL_REGISTRY = process.env.FACET_CLI_REGISTRY

// Bun (and Node.js types) augment `typeof globalThis.fetch` with a
// `.preconnect` property, so `mockImplementation` requires an arrow
// function with that property — which test stubs never have. Retype the
// spy as a plain `(url, init?) => Promise<Response>` so all the helpers
// below stay cast-free. The runtime behavior of `spyOn` is unchanged.
type PlainFetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
const fetchSpy = spyOn(globalThis, 'fetch') as unknown as Mock<PlainFetch>

beforeEach(() => {
  // Each test owns the env var. Clear before so leaked state from a
  // previous test can't influence this one.
  delete process.env.FACET_CLI_REGISTRY
  fetchSpy.mockClear()
})

afterEach(() => {
  if (ORIGINAL_REGISTRY === undefined) {
    delete process.env.FACET_CLI_REGISTRY
  } else {
    process.env.FACET_CLI_REGISTRY = ORIGINAL_REGISTRY
  }
})

afterAll(() => {
  fetchSpy.mockRestore()
})

/** Make `fetch` return a JSON response with the given body and status. */
function mockFetchJson(body: unknown, status = 200): void {
  fetchSpy.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
}

/** Make `fetch` return a non-JSON body (raw text), useful for "malformed" tests. */
function mockFetchRaw(body: string, status: number): void {
  fetchSpy.mockImplementation(async () => new Response(body, { status }))
}

/** Make `fetch` reject — simulates a network error. */
function mockFetchThrow(error: Error): void {
  fetchSpy.mockImplementation(async () => {
    throw error
  })
}

describe('getLatestVersion', () => {
  test('returns the version field from a happy-path registry response', async () => {
    mockFetchJson({ name: 'agent-facets', version: '0.8.0' })
    expect(await getLatestVersion()).toBe('0.8.0')
  })

  test('uses the default registry URL when no override is set', async () => {
    mockFetchJson({ version: '0.8.0' })
    await getLatestVersion()
    expect(fetchSpy).toHaveBeenCalledWith('https://registry.npmjs.org/agent-facets/latest', expect.any(Object))
  })

  test('honors FACET_CLI_REGISTRY env var', async () => {
    process.env.FACET_CLI_REGISTRY = 'https://npm.example.com'
    mockFetchJson({ version: '1.2.3' })
    expect(await getLatestVersion()).toBe('1.2.3')
    expect(fetchSpy).toHaveBeenCalledWith('https://npm.example.com/agent-facets/latest', expect.any(Object))
  })

  test('trims a single trailing slash from the registry URL', async () => {
    process.env.FACET_CLI_REGISTRY = 'https://npm.example.com/'
    mockFetchJson({ version: '0.8.0' })
    await getLatestVersion()
    expect(fetchSpy).toHaveBeenCalledWith('https://npm.example.com/agent-facets/latest', expect.any(Object))
  })

  test('trims multiple trailing slashes from the registry URL', async () => {
    process.env.FACET_CLI_REGISTRY = 'https://npm.example.com///'
    mockFetchJson({ version: '0.8.0' })
    await getLatestVersion()
    expect(fetchSpy).toHaveBeenCalledWith('https://npm.example.com/agent-facets/latest', expect.any(Object))
  })

  test('an empty FACET_CLI_REGISTRY falls back to the default', async () => {
    process.env.FACET_CLI_REGISTRY = ''
    mockFetchJson({ version: '0.8.0' })
    await getLatestVersion()
    expect(fetchSpy).toHaveBeenCalledWith('https://registry.npmjs.org/agent-facets/latest', expect.any(Object))
  })

  test('throws a clear error when fetch rejects (network error)', async () => {
    mockFetchThrow(new Error('ECONNREFUSED'))
    await expect(getLatestVersion()).rejects.toThrow(
      /failed to fetch latest agent-facets version.*network error: ECONNREFUSED/s,
    )
  })

  test('error mentions the URL it tried', async () => {
    process.env.FACET_CLI_REGISTRY = 'https://wat.example.com'
    mockFetchThrow(new Error('boom'))
    await expect(getLatestVersion()).rejects.toThrow(/https:\/\/wat\.example\.com\/agent-facets\/latest/)
  })

  test('error includes the FACET_CLI_REGISTRY hint line', async () => {
    mockFetchThrow(new Error('boom'))
    await expect(getLatestVersion()).rejects.toThrow(/set FACET_CLI_REGISTRY to a reachable mirror/)
  })

  test('throws when registry returns a non-2xx status', async () => {
    mockFetchRaw('not found', 404)
    await expect(getLatestVersion()).rejects.toThrow(/HTTP 404/)
  })

  test('throws when registry returns 503', async () => {
    mockFetchRaw('service unavailable', 503)
    await expect(getLatestVersion()).rejects.toThrow(/HTTP 503/)
  })

  test('throws when response body is not valid JSON', async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response('this is not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await expect(getLatestVersion()).rejects.toThrow(/response was not valid JSON/)
  })

  test('throws when JSON has no version field', async () => {
    mockFetchJson({ name: 'agent-facets' })
    await expect(getLatestVersion()).rejects.toThrow(/response did not include a "version" field/)
  })

  test('throws when version is not a string', async () => {
    mockFetchJson({ name: 'agent-facets', version: 42 })
    await expect(getLatestVersion()).rejects.toThrow(/response did not include a "version" field/)
  })

  test('throws when version is an empty string', async () => {
    mockFetchJson({ name: 'agent-facets', version: '' })
    await expect(getLatestVersion()).rejects.toThrow(/response did not include a "version" field/)
  })

  test('throws when JSON body is null', async () => {
    mockFetchJson(null)
    await expect(getLatestVersion()).rejects.toThrow(/response did not include a "version" field/)
  })

  test('sends accept: application/json header', async () => {
    mockFetchJson({ version: '0.8.0' })
    await getLatestVersion()
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/json' }),
      }),
    )
  })
})
