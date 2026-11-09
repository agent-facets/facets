import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RegistrySpec } from '../types.ts'
import { fetchRegistryVersionDetails, versionDetailsFromWire } from '../version-details.ts'
import type { WireMetadataResponse } from '../wire.ts'

const REGISTRY = 'https://registry.test'

const BODY = {
  name: 'mobbin',
  version: '1.0.0',
  content_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  content_integrity: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  manifest_json: '{"name":"mobbin","version":"1.0.0"}',
  owner: { kind: 'user', username: 'julian' },
  publisher: 'julian',
  published_at: '2026-11-02T00:00:00.000Z',
  size_bytes: 1024,
  visibility: 'public',
  asset_counts: { agents: 0, commands: 0, servers: 1, skills: 1 },
  author: 'Julian Smith',
  description: 'Search real-world UI design references.',
} satisfies WireMetadataResponse

const LATEST: RegistrySpec = { name: 'mobbin', version: { kind: 'latest' } }

describe('versionDetailsFromWire', () => {
  test('maps every published field, keeping author and publisher apart', () => {
    const result = versionDetailsFromWire(BODY, LATEST)
    if (!result.ok) expect.unreachable()
    expect(result.value).toEqual({
      name: 'mobbin',
      version: '1.0.0',
      contentFingerprint: BODY.content_integrity,
      author: 'Julian Smith',
      description: 'Search real-world UI design references.',
      owner: { kind: 'user', username: 'julian' },
      publisher: 'julian',
      publishedAt: '2026-11-02T00:00:00.000Z',
      manifestJson: BODY.manifest_json,
    })
  })

  test('maps an organization owner', () => {
    const result = versionDetailsFromWire({ ...BODY, owner: { kind: 'org', slug: 'acme' } }, LATEST)
    if (!result.ok) expect.unreachable()
    expect(result.value.owner).toEqual({ kind: 'org', slug: 'acme' })
  })

  test('omits an empty author and description instead of carrying empty strings', () => {
    const result = versionDetailsFromWire({ ...BODY, author: '', description: '' }, LATEST)
    if (!result.ok) expect.unreachable()
    expect('author' in result.value).toBe(false)
    expect('description' in result.value).toBe(false)
  })

  test.each([
    ['publisher', { publisher: '' }, 'verified publisher'],
    ['manifest_json', { manifest_json: '' }, 'manifest_json'],
    ['published_at', { published_at: '' }, 'published_at'],
  ] as const)('fails closed when %s is empty', (_field, patch, expected) => {
    const result = versionDetailsFromWire({ ...BODY, ...patch }, LATEST)
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain(expected)
  })

  test('fails closed on an owner without its identifying field', () => {
    const malformed = JSON.parse('{"kind":"user"}')
    const result = versionDetailsFromWire({ ...BODY, owner: malformed }, LATEST)
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('owner')
  })

  test('refuses a body that describes another facet', () => {
    const result = versionDetailsFromWire({ ...BODY, name: 'other' }, LATEST)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })
})

describe('fetchRegistryVersionDetails', () => {
  let facetDir: string
  let originalEnv: { facetDir: string | undefined; token: string | undefined; registry: string | undefined }
  let fetchSpy: { mockRestore(): void } | undefined

  beforeEach(() => {
    originalEnv = {
      facetDir: process.env.FACET_DIR,
      token: process.env.FACET_TOKEN,
      registry: process.env.FACET_REGISTRY_URL,
    }
    facetDir = mkdtempSync(join(tmpdir(), 'facet-version-details-'))
    process.env.FACET_DIR = facetDir
    process.env.FACET_REGISTRY_URL = REGISTRY
    delete process.env.FACET_TOKEN
  })

  afterEach(() => {
    fetchSpy?.mockRestore()
    fetchSpy = undefined
    rmSync(facetDir, { recursive: true, force: true })
    restore('FACET_DIR', originalEnv.facetDir)
    restore('FACET_TOKEN', originalEnv.token)
    restore('FACET_REGISTRY_URL', originalEnv.registry)
  })

  function stubRequests(handler: (request: Request) => Response | Promise<Response>): Request[] {
    const seen: Request[] = []
    const fetcher = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input.toString(), init)
      seen.push(request)
      return handler(request)
    }
    fetcher.preconnect = globalThis.fetch.preconnect
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(fetcher)
    return seen
  }

  test('reads an unscoped facet from the unscoped route', async () => {
    const seen = stubRequests(() => json(BODY))
    const result = await fetchRegistryVersionDetails(LATEST)
    if (!result.ok) expect.unreachable()
    expect(result.value.publisher).toBe('julian')
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual(['/v0/facets/mobbin/latest'])
  })

  test('reads a scoped facet from the two-segment scoped route', async () => {
    const scoped = { ...BODY, name: '@agentfacets/mobbin' }
    const seen = stubRequests(() => json(scoped))
    const result = await fetchRegistryVersionDetails({ name: '@agentfacets/mobbin', version: { kind: 'latest' } })
    if (!result.ok) expect.unreachable()
    expect(seen.map((r) => decodeURIComponent(new URL(r.url).pathname))).toEqual([
      '/v0/facets/@agentfacets/mobbin/latest',
    ])
  })

  test('reports a missing facet as NOT_FOUND with the requested name', async () => {
    stubRequests(() => json({ code: 'E_FACET_NOT_FOUND', error: 'not found', fix: 'search' }, 404))
    const result = await fetchRegistryVersionDetails(LATEST)
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', name: 'mobbin', spec: 'latest' } })
  })

  test('reports an unreachable registry without retrying when retries are disabled', async () => {
    const seen = stubRequests(() => {
      throw new TypeError('fetch failed')
    })
    const result = await fetchRegistryVersionDetails(LATEST, { retry: { maxAttempts: 1 } })
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NETWORK_ERROR')
    expect(seen).toHaveLength(1)
  })

  test('returns a sign-in failure before any request', async () => {
    mkdirSync(join(facetDir, 'credentials'))
    const seen = stubRequests(() => json(BODY))
    const result = await fetchRegistryVersionDetails(LATEST)
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'AUTHENTICATION_ERROR') expect.unreachable()
    expect(result.error.reason.code).toBe('PAT_UNREADABLE')
    expect(seen).toHaveLength(0)
  })
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
