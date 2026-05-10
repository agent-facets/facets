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

describe('getLatestVersion — happy path', () => {
  test('returns ok=true with the version field on a happy-path registry response', async () => {
    mockFetchJson({ name: 'agent-facets', version: '0.8.0' })
    const result = await getLatestVersion()
    if (!result.ok) expect.unreachable()
    expect(result.version).toBe('0.8.0')
  })

  test('uses the default registry URL when no override is set', async () => {
    mockFetchJson({ version: '0.8.0' })
    await getLatestVersion()
    expect(fetchSpy).toHaveBeenCalledWith('https://registry.npmjs.org/agent-facets/latest', expect.any(Object))
  })

  test('honors FACET_CLI_REGISTRY env var', async () => {
    process.env.FACET_CLI_REGISTRY = 'https://npm.example.com'
    mockFetchJson({ version: '1.2.3' })
    const result = await getLatestVersion()
    if (!result.ok) expect.unreachable()
    expect(result.version).toBe('1.2.3')
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

describe('getLatestVersion — failure modes (returned, never thrown)', () => {
  test('network failure: ok=false, reason=network, carries url and cause', async () => {
    mockFetchThrow(new Error('ECONNREFUSED'))
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    if (result.reason !== 'network') expect.unreachable()
    expect(result.url).toBe('https://registry.npmjs.org/agent-facets/latest')
    expect(result.cause).toBe('ECONNREFUSED')
  })

  test('network failure preserves the registry override URL in the failure', async () => {
    process.env.FACET_CLI_REGISTRY = 'https://wat.example.com'
    mockFetchThrow(new Error('boom'))
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    if (result.reason !== 'network') expect.unreachable()
    expect(result.url).toBe('https://wat.example.com/agent-facets/latest')
    expect(result.cause).toBe('boom')
  })

  test('http 404: ok=false, reason=http, carries status', async () => {
    mockFetchRaw('not found', 404)
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    if (result.reason !== 'http') expect.unreachable()
    expect(result.status).toBe(404)
    expect(result.url).toBe('https://registry.npmjs.org/agent-facets/latest')
  })

  test('http 503: ok=false, reason=http, carries status', async () => {
    mockFetchRaw('service unavailable', 503)
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    if (result.reason !== 'http') expect.unreachable()
    expect(result.status).toBe(503)
  })

  test('non-JSON body: ok=false, reason=invalid-json', async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response('this is not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('invalid-json')
  })

  test('JSON has no version field: ok=false, reason=missing-version', async () => {
    mockFetchJson({ name: 'agent-facets' })
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('missing-version')
  })

  test('version is not a string: ok=false, reason=missing-version', async () => {
    mockFetchJson({ name: 'agent-facets', version: 42 })
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('missing-version')
  })

  test('version is an empty string: ok=false, reason=missing-version', async () => {
    mockFetchJson({ name: 'agent-facets', version: '' })
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('missing-version')
  })

  test('JSON body is null: ok=false, reason=missing-version', async () => {
    mockFetchJson(null)
    const result = await getLatestVersion()
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('missing-version')
  })
})
