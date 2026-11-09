import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentsFromWire, fetchRegistryVersionContents } from '../contents.ts'
import type { WireContentsResponse } from '../wire.ts'

const REGISTRY = 'https://registry.test'
const HASH = 'sha256:3333333333333333333333333333333333333333333333333333333333333333'

const README_FILE = {
  kind: 'text',
  path: 'README.md',
  content: '# Mobbin\n',
  sha256: HASH,
  size_bytes: 9,
} satisfies WireContentsResponse['files'][number]

const BODY = {
  name: 'mobbin',
  version: '1.0.0',
  content_integrity: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  files: [
    README_FILE,
    { kind: 'text', path: 'skills/using-mobbin/SKILL.md', content: 'Use Mobbin.\n', sha256: HASH, size_bytes: 12 },
    { kind: 'binary', path: 'skills/using-mobbin/assets/logo.png', sha256: HASH, size_bytes: 2048 },
  ],
} satisfies WireContentsResponse

describe('contentsFromWire', () => {
  test('keys files by path and keeps text content and binary size', () => {
    const result = contentsFromWire(BODY, 'mobbin', '1.0.0')
    if (!result.ok) expect.unreachable()
    expect(result.value.contentFingerprint).toBe(BODY.content_integrity)
    expect(result.value.files.get('README.md')).toEqual({ kind: 'text', path: 'README.md', content: '# Mobbin\n' })
    expect(result.value.files.get('skills/using-mobbin/assets/logo.png')).toEqual({
      kind: 'binary',
      path: 'skills/using-mobbin/assets/logo.png',
      sizeBytes: 2048,
    })
    expect(result.value.files.size).toBe(3)
  })

  test.each([
    ['another facet', { name: 'other' }],
    ['another version', { version: '1.0.1' }],
  ] as const)('refuses a body that describes %s', (_label, patch) => {
    const result = contentsFromWire({ ...BODY, ...patch }, 'mobbin', '1.0.0')
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test('refuses a duplicate path', () => {
    const result = contentsFromWire({ ...BODY, files: [README_FILE, README_FILE] }, 'mobbin', '1.0.0')
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('duplicate')
  })

  test('refuses a text entry without content', () => {
    const malformed = JSON.parse('{"kind":"text","path":"README.md","sha256":"x","size_bytes":1}')
    const result = contentsFromWire({ ...BODY, files: [malformed] }, 'mobbin', '1.0.0')
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('README.md')
  })
})

describe('fetchRegistryVersionContents', () => {
  let facetDir: string
  let originalEnv: { facetDir: string | undefined; token: string | undefined; registry: string | undefined }
  let fetchSpy: { mockRestore(): void } | undefined

  beforeEach(() => {
    originalEnv = {
      facetDir: process.env.FACET_DIR,
      token: process.env.FACET_TOKEN,
      registry: process.env.FACET_REGISTRY_URL,
    }
    facetDir = mkdtempSync(join(tmpdir(), 'facet-contents-'))
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

  function stubRequests(handler: (request: Request) => Response): Request[] {
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

  test('reads an unscoped version from the contents route', async () => {
    const seen = stubRequests(() => json(BODY))
    const result = await fetchRegistryVersionContents('mobbin', '1.0.0')
    if (!result.ok) expect.unreachable()
    expect(result.value.files.size).toBe(3)
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual(['/v0/facets/mobbin/1.0.0/contents'])
  })

  test('reads a scoped version from the scoped contents route', async () => {
    const seen = stubRequests(() => json({ ...BODY, name: '@agentfacets/mobbin' }))
    const result = await fetchRegistryVersionContents('@agentfacets/mobbin', '1.0.0')
    if (!result.ok) expect.unreachable()
    expect(seen.map((r) => decodeURIComponent(new URL(r.url).pathname))).toEqual([
      '/v0/facets/@agentfacets/mobbin/1.0.0/contents',
    ])
  })

  test('reports a missing version as NOT_FOUND', async () => {
    stubRequests(() => json({ code: 'E_FACET_NOT_FOUND', error: 'not found', fix: 'search' }, 404))
    const result = await fetchRegistryVersionContents('mobbin', '9.9.9')
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', name: 'mobbin', spec: '9.9.9' } })
  })
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
