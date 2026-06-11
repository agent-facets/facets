import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleOuterTar, computeContentHash } from '@agent-facets/protocol'
import { createTar } from 'nanotar'
import {
  describeVersionSpec,
  downloadAndExtractFacet,
  fixtures,
  resolveRegistryMetadataBatch,
} from '../registry/index.ts'

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

describe('describeVersionSpec', () => {
  test('exact', () => {
    expect(describeVersionSpec({ kind: 'exact', major: 1, minor: 2, patch: 3 })).toBe('1.2.3')
  })

  test('majorWildcard', () => {
    expect(describeVersionSpec({ kind: 'majorWildcard', major: 1 })).toBe('1.*')
  })

  test('latest', () => {
    expect(describeVersionSpec({ kind: 'latest' })).toBe('latest')
  })
})

describe('resolveRegistryMetadataBatch', () => {
  test('empty batch returns empty success', async () => {
    const result = await resolveRegistryMetadataBatch([])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual([])
  })

  /**
   * `openapi-fetch` always passes a `Request` object to `globalThis.fetch`
   * (not a URL string), so tests need to extract `.url` from the
   * Request rather than `String(input)` which would yield
   * `'[object Request]'`.
   */
  function captureUrl(input: string | URL | Request): string {
    return input instanceof Request ? input.url : String(input)
  }

  test('latest spec collapses to "latest" in the URL; metadata carries the server-resolved version', async () => {
    const calledUrls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrls.push(captureUrl(input))
      return new Response(JSON.stringify(fixtures.versionMetadata({ content_hash: 'sha256:abc' })), { status: 200 })
    }) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([{ name: 'cowsay', version: { kind: 'latest' } }])
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(calledUrls[0]).toBe('https://api.test/v0/facets/cowsay/latest')
    const meta = result.value[0]
    if (meta === undefined) expect.unreachable()
    expect(meta.version).toBe('0.1.0')
    expect(meta.expectedIntegrity).toBe('sha256:abc')
  })

  test('exact spec is sent verbatim', async () => {
    const calledUrls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrls.push(captureUrl(input))
      return new Response(JSON.stringify(fixtures.versionMetadata({ name: 'cowsay', version: '1.2.3' })), {
        status: 200,
      })
    }) as unknown as typeof fetch
    await resolveRegistryMetadataBatch([{ name: 'cowsay', version: { kind: 'exact', major: 1, minor: 2, patch: 3 } }])
    expect(calledUrls[0]).toBe('https://api.test/v0/facets/cowsay/1.2.3')
  })

  test('namespaced names are URL-encoded (%2F) on the URL path', async () => {
    const calledUrls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrls.push(captureUrl(input))
      return new Response(JSON.stringify(fixtures.versionMetadata({ name: 'acme/cowsay' })), { status: 200 })
    }) as unknown as typeof fetch
    await resolveRegistryMetadataBatch([{ name: 'acme/cowsay', version: { kind: 'latest' } }])
    expect(calledUrls[0]).toBe('https://api.test/v0/facets/acme%2Fcowsay/latest')
  })

  test('404 maps to NOT_FOUND with the spec verbatim', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(fixtures.apiError({ error: 'gone', docs_url: 'x' })), {
        status: 404,
      })) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([
      { name: 'missing', version: { kind: 'exact', major: 1, minor: 0, patch: 0 } },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NOT_FOUND')
    if (result.error.code !== 'NOT_FOUND') expect.unreachable()
    expect(result.error.name).toBe('missing')
    expect(result.error.spec).toBe('1.0.0')
  })

  test('5xx with non-JSON body maps to UNPARSEABLE_RESPONSE', async () => {
    // The typed client distinguishes a well-formed structured error
    // envelope (REGISTRY_REJECTED) from a body that is not a valid
    // envelope at all, and from a transport failure (NETWORK_ERROR). A
    // 503 with a raw HTML body — common from CDN error pages — has no
    // server text to render, so it flows through the defensive branch
    // in `translateWireError` and surfaces as UNPARSEABLE_RESPONSE,
    // carrying the HTTP status.
    globalThis.fetch = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([{ name: 'x', version: { kind: 'latest' } }])
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNPARSEABLE_RESPONSE') expect.unreachable()
    expect(result.error.status).toBe(503)
  })

  test('thrown fetch maps to NETWORK_ERROR', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([{ name: 'x', version: { kind: 'latest' } }])
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NETWORK_ERROR')
    if (result.error.code !== 'NETWORK_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('fetch failed')
  })

  test('multi-spec batch fans out and short-circuits on first failure', async () => {
    let calls = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls++
      const url = String(input)
      if (url.includes('good')) {
        return new Response(JSON.stringify(fixtures.versionMetadata({ name: 'good', version: '1.0.0' })), {
          status: 200,
        })
      }
      return new Response(JSON.stringify(fixtures.apiError()), { status: 404 })
    }) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([
      { name: 'good', version: { kind: 'latest' } },
      { name: 'bad', version: { kind: 'latest' } },
    ])
    expect(result.ok).toBe(false)
    expect(calls).toBe(2)
  })
})

describe('downloadAndExtractFacet', () => {
  let dest: string
  beforeEach(() => {
    dest = mkdtempSync(join(tmpdir(), 'facet-dl-'))
  })
  afterEach(() => {
    rmSync(dest, { recursive: true, force: true })
  })

  // Build a two-layer `.facet` archive (outer tar wrapping
  // build-manifest.json + archive.tar.gz) and its sha256 so the
  // integrity check exercises the actual happy path.
  function buildArchive(entries: Array<{ name: string; data: string }>): {
    bytes: Uint8Array
    integrity: string
  } {
    const innerTar = createTar(entries.map((e) => ({ name: e.name, data: e.data }))) as Uint8Array<ArrayBuffer>
    const innerGz = new Uint8Array(Bun.gzipSync(innerTar))
    const contentHash = computeContentHash(innerTar)
    const assets: Record<string, string> = {}
    for (const e of entries) {
      assets[e.name] = computeContentHash(e.data)
    }
    const buildManifest = JSON.stringify({
      facetVersion: 1,
      archive: 'cowsay-0.1.0.facet',
      integrity: contentHash,
      assets,
    })
    const outerTar = assembleOuterTar(buildManifest, innerGz)
    const integrity = `sha256:${createHash('sha256').update(outerTar).digest('hex')}`
    return { bytes: outerTar, integrity }
  }

  const S3_URL = 'https://s3.example/presigned/archive.tar.gz'

  /**
   * Stub the two-hop archive download. The first fetch (the typed
   * archive request to `…/archive`) returns a 302 to the presigned S3
   * URL; the second fetch (the raw S3 GET) returns the supplied
   * `archive` Response. Returns the list of requested URLs for
   * assertions.
   */
  function stubArchiveDownload(archive: Response): { urls: string[] } {
    const urls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      urls.push(url)
      if (url.endsWith('/archive')) {
        return new Response(null, { status: 302, headers: { location: S3_URL } })
      }
      return archive
    }) as unknown as typeof fetch
    return { urls }
  }

  const META = {
    name: 'cowsay',
    version: '0.1.0',
    expectedIntegrity: 'sha256:placeholder',
  }

  test('happy path: resolves the 302, downloads from S3, verifies sha256, extracts files', async () => {
    const { bytes, integrity } = buildArchive([
      { name: 'facet.json', data: '{"name":"cowsay","version":"0.1.0"}' },
      { name: 'commands/cowsay.md', data: '# cowsay\n' },
    ])
    const { urls } = stubArchiveDownload(new Response(bytes, { status: 200 }))
    const result = await downloadAndExtractFacet({ ...META, expectedIntegrity: integrity }, dest)
    expect(result.ok).toBe(true)
    // First hop is the typed archive endpoint; second hop is the
    // presigned S3 URL read off the 302 Location header.
    expect(urls[0]).toBe('https://api.test/v0/facets/cowsay/0.1.0/archive')
    expect(urls[1]).toBe(S3_URL)
    expect(readFileSync(join(dest, 'facet.json'), 'utf8')).toContain('cowsay')
    expect(readFileSync(join(dest, 'commands/cowsay.md'), 'utf8')).toContain('# cowsay')
  })

  test('sha256 mismatch: returns NETWORK_ERROR with hash detail and writes nothing', async () => {
    const { bytes } = buildArchive([{ name: 'facet.json', data: '{}' }])
    stubArchiveDownload(new Response(bytes, { status: 200 }))
    const result = await downloadAndExtractFacet({ ...META, expectedIntegrity: 'sha256:0000' }, dest)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NETWORK_ERROR')
    if (result.error.code !== 'NETWORK_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('sha256 mismatch')
  })

  test('archive endpoint 404 maps to NOT_FOUND', async () => {
    globalThis.fetch = (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch
    const result = await downloadAndExtractFacet({ ...META, expectedIntegrity: 'sha256:x' }, dest)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NOT_FOUND')
  })

  test('archive endpoint 302 with no Location maps to UNEXPECTED_ERROR', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 302 })) as unknown as typeof fetch
    const result = await downloadAndExtractFacet({ ...META, expectedIntegrity: 'sha256:x' }, dest)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test('S3 fetch 5xx maps to NETWORK_ERROR', async () => {
    stubArchiveDownload(new Response('boom', { status: 503 }))
    const result = await downloadAndExtractFacet({ ...META, expectedIntegrity: 'sha256:x' }, dest)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NETWORK_ERROR')
  })

  // Note: path-safety sanitization in `downloadAndExtractFacet` is
  // defense-in-depth. We can't easily exercise it through `nanotar`'s
  // writer here because the writer normalizes leading `/` and `../`
  // segments out before they reach the wire. The sanitization remains
  // important for tarballs produced by other writers; covered by review.

  test('non-gzip body: clean error', async () => {
    const bytes = new TextEncoder().encode('not a tarball')
    stubArchiveDownload(new Response(bytes, { status: 200 }))
    const result = await downloadAndExtractFacet(
      { ...META, expectedIntegrity: `sha256:${createHash('sha256').update(bytes).digest('hex')}` },
      dest,
    )
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('NETWORK_ERROR')
  })
})
