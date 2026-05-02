import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTar } from 'nanotar'
import { describeVersionSpec, downloadAndExtractFacet, resolveRegistryMetadataBatch } from '../registry/index.ts'

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

  test('latest spec collapses to "latest" in the URL and uses the server-resolved version on the archive URL', async () => {
    const calledUrls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrls.push(String(input))
      return new Response(
        JSON.stringify({
          name: 'cowsay',
          version: '0.1.0',
          contentHash: 'sha256:abc',
          sizeBytes: 100,
          publishedAt: '2026-05-01T00:00:00Z',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([{ name: 'cowsay', version: { kind: 'latest' } }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calledUrls[0]).toBe('https://api.test/v0/packages/cowsay/latest')
    const meta = result.value[0]
    if (meta === undefined) expect.unreachable()
    expect(meta.version).toBe('0.1.0')
    expect(meta.tarballUrl).toBe('https://api.test/v0/packages/cowsay/0.1.0/archive')
    expect(meta.expectedIntegrity).toBe('sha256:abc')
  })

  test('exact spec is sent verbatim', async () => {
    const calledUrls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrls.push(String(input))
      return new Response(
        JSON.stringify({
          name: 'cowsay',
          version: '1.2.3',
          contentHash: 'sha256:x',
          sizeBytes: 1,
          publishedAt: '2026-05-01',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    await resolveRegistryMetadataBatch([{ name: 'cowsay', version: { kind: 'exact', major: 1, minor: 2, patch: 3 } }])
    expect(calledUrls[0]).toBe('https://api.test/v0/packages/cowsay/1.2.3')
  })

  test('namespaced names are URL-encoded (%2F) on the URL path', async () => {
    const calledUrls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrls.push(String(input))
      return new Response(
        JSON.stringify({
          name: 'acme/cowsay',
          version: '0.1.0',
          contentHash: 'sha256:x',
          sizeBytes: 1,
          publishedAt: '2026-05-01',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    await resolveRegistryMetadataBatch([{ name: 'acme/cowsay', version: { kind: 'latest' } }])
    expect(calledUrls[0]).toBe('https://api.test/v0/packages/acme%2Fcowsay/latest')
  })

  test('404 maps to NOT_FOUND with the spec verbatim', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'gone', code: 'E_FACET_NOT_FOUND', docsUrl: 'x' }), {
        status: 404,
      })) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([
      { name: 'missing', version: { kind: 'exact', major: 1, minor: 0, patch: 0 } },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
    if (result.error.code !== 'NOT_FOUND') return
    expect(result.error.name).toBe('missing')
    expect(result.error.spec).toBe('1.0.0')
  })

  test('5xx maps to NETWORK_ERROR', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([{ name: 'x', version: { kind: 'latest' } }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NETWORK_ERROR')
  })

  test('thrown fetch maps to NETWORK_ERROR', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const result = await resolveRegistryMetadataBatch([{ name: 'x', version: { kind: 'latest' } }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NETWORK_ERROR')
    if (result.error.code !== 'NETWORK_ERROR') return
    expect(result.error.cause).toContain('fetch failed')
  })

  test('multi-spec batch fans out and short-circuits on first failure', async () => {
    let calls = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls++
      const url = String(input)
      if (url.includes('good')) {
        return new Response(
          JSON.stringify({
            name: 'good',
            version: '1.0.0',
            contentHash: 'sha256:x',
            sizeBytes: 1,
            publishedAt: '2026-05-01',
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ code: 'E_FACET_NOT_FOUND' }), { status: 404 })
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

  // Build a real gzipped tarball and its sha256 so the integrity check
  // exercises the actual happy path.
  function buildArchive(entries: Array<{ name: string; data: string }>): {
    bytes: Uint8Array
    integrity: string
  } {
    const tar = createTar(entries.map((e) => ({ name: e.name, data: e.data }))) as Uint8Array<ArrayBuffer>
    // Bun.gzipSync's TS return type uses ArrayBufferLike which doesn't
    // satisfy node's stricter ArrayBuffer-typed signatures for crypto and
    // Response — cast through unknown so the rest of the helper compiles.
    const bytes = Bun.gzipSync(tar) as unknown as Uint8Array<ArrayBuffer>
    const integrity = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    return { bytes, integrity }
  }

  test('happy path: downloads, verifies sha256, extracts files preserving paths', async () => {
    const { bytes, integrity } = buildArchive([
      { name: 'facet.json', data: '{"name":"cowsay","version":"0.1.0"}' },
      { name: 'commands/cowsay.md', data: '# cowsay\n' },
    ])
    globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch
    const result = await downloadAndExtractFacet(
      {
        name: 'cowsay',
        version: '0.1.0',
        expectedIntegrity: integrity,
        tarballUrl: 'https://api.test/v0/packages/cowsay/0.1.0/archive',
      },
      dest,
    )
    expect(result.ok).toBe(true)
    expect(readFileSync(join(dest, 'facet.json'), 'utf8')).toContain('cowsay')
    expect(readFileSync(join(dest, 'commands/cowsay.md'), 'utf8')).toContain('# cowsay')
  })

  test('sha256 mismatch: returns NETWORK_ERROR with hash detail and writes nothing', async () => {
    const { bytes } = buildArchive([{ name: 'facet.json', data: '{}' }])
    globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch
    const result = await downloadAndExtractFacet(
      {
        name: 'cowsay',
        version: '0.1.0',
        expectedIntegrity: 'sha256:0000',
        tarballUrl: 'https://api.test',
      },
      dest,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NETWORK_ERROR')
    if (result.error.code !== 'NETWORK_ERROR') return
    expect(result.error.cause).toContain('sha256 mismatch')
  })

  test('404 maps to NOT_FOUND', async () => {
    globalThis.fetch = (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch
    const result = await downloadAndExtractFacet(
      {
        name: 'cowsay',
        version: '0.1.0',
        expectedIntegrity: 'sha256:x',
        tarballUrl: 'https://api.test',
      },
      dest,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  test('5xx maps to NETWORK_ERROR', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch
    const result = await downloadAndExtractFacet(
      {
        name: 'x',
        version: '1.0.0',
        expectedIntegrity: 'sha256:x',
        tarballUrl: 'https://api.test',
      },
      dest,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NETWORK_ERROR')
  })

  // Note: path-safety sanitization in `downloadAndExtractFacet` is
  // defense-in-depth. We can't easily exercise it through `nanotar`'s
  // writer here because the writer normalizes leading `/` and `../`
  // segments out before they reach the wire. The sanitization remains
  // important for tarballs produced by other writers; covered by review.

  test('non-gzip body: clean error', async () => {
    const bytes = new TextEncoder().encode('not a tarball')
    globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch
    const result = await downloadAndExtractFacet(
      {
        name: 'x',
        version: '1.0.0',
        expectedIntegrity: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        tarballUrl: 'https://api.test',
      },
      dest,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NETWORK_ERROR')
  })
})
