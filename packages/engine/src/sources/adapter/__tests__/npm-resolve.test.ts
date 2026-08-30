import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { ADAPTER_API_VERSION, ADAPTER_API_VERSION_PACKAGE_FIELD } from '@agent-facets/adapter/api-version'
import { SUPPORTED_ADAPTER_APIS } from '../../../adapters/api-compatibility.ts'
import { downloadNpmRelease, resolveNpmAdapter } from '../npm.ts'
import type { NpmVersionRequest } from '../specifier.ts'

/**
 * Fake-registry tests for compatibility-aware npm resolution.
 *
 * A `Bun.serve` instance on an ephemeral port serves packuments and
 * tarball bytes. Version entries are declared per test via the
 * `packuments` map; tarballs are real gzipped tars produced in-memory.
 */

/** Minimal gzipped tarball containing a single `package/package.json`. */
function makeTarball(content: string): Uint8Array {
  const body = new TextEncoder().encode(content)
  const name = 'package/package.json'
  const header = new Uint8Array(512)
  const write = (text: string, offset: number): void => {
    for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i)
  }
  write(name, 0)
  write('0000644\0', 100) // mode
  write('0000000\0', 108) // uid
  write('0000000\0', 116) // gid
  write(`${body.length.toString(8).padStart(11, '0')}\0`, 124) // size
  write('00000000000\0', 136) // mtime
  write('        ', 148) // checksum placeholder (spaces while computing)
  header[156] = 48 // typeflag '0'
  write('ustar\0', 257)
  write('00', 263)
  let checksum = 0
  for (const byte of header) checksum += byte
  write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)

  const padded = new Uint8Array(512 + Math.ceil(body.length / 512) * 512 + 1024)
  padded.set(header, 0)
  padded.set(body, 512)
  return Bun.gzipSync(padded)
}

interface FakeVersion {
  /** Adapter API declaration; `undefined` omits the field entirely. */
  api?: unknown
  /** Omit dist.integrity/shasum when false-y flags are set. */
  noIntegrity?: boolean
  useShasumOnly?: boolean
  /** Corrupt the advertised integrity so downloads fail verification. */
  corruptIntegrity?: boolean
  /** Omit dist entirely. */
  noDist?: boolean
}

const tarballBytes = makeTarball(JSON.stringify({ name: 'fake', version: '0.0.0' }))
const goodSri = `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`
const goodShasum = createHash('sha1').update(tarballBytes).digest('hex')

let server: ReturnType<typeof Bun.serve>
let baseUrl: string
/** name → { versions, distTags } served by the fake registry. */
const packuments = new Map<string, { versions: Record<string, FakeVersion>; distTags?: Record<string, string> }>()

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/tarballs/good.tgz') {
        return new Response(tarballBytes)
      }
      const name = decodeURIComponent(url.pathname.slice(1))
      const entry = packuments.get(name)
      if (!entry) return new Response('not found', { status: 404 })
      if (name === 'broken-json') return new Response('{not json', { headers: { 'content-type': 'application/json' } })
      if (name === 'no-versions') return new Response(JSON.stringify({ name }))

      const versions: Record<string, unknown> = {}
      for (const [version, spec] of Object.entries(entry.versions)) {
        const dist = spec.noDist
          ? undefined
          : {
              tarball: `${baseUrl}/tarballs/good.tgz`,
              ...(spec.noIntegrity
                ? {}
                : spec.useShasumOnly
                  ? { shasum: goodShasum }
                  : { integrity: spec.corruptIntegrity ? `sha512-${'A'.repeat(88)}` : goodSri }),
            }
        versions[version] = {
          version,
          ...(spec.api === undefined ? {} : { [ADAPTER_API_VERSION_PACKAGE_FIELD]: spec.api }),
          ...(dist ? { dist } : {}),
        }
      }
      return new Response(JSON.stringify({ name, 'dist-tags': entry.distTags ?? {}, versions }))
    },
  })
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop(true)
})

const implicit: NpmVersionRequest = { kind: 'implicit' }
const opts = () => ({ registryBaseUrl: baseUrl })

describe('resolveNpmAdapter — compatible selection', () => {
  test('bare package skips a newer incompatible release', async () => {
    packuments.set('skip-newer', {
      versions: {
        '1.0.0': { api: ADAPTER_API_VERSION },
        '1.1.0': { api: ADAPTER_API_VERSION },
        '2.0.0': { api: '9.9' },
      },
    })
    const result = await resolveNpmAdapter('skip-newer', implicit, opts())
    if (!result.ok) expect.unreachable()
    expect(result.release.version).toBe('1.1.0')
    expect(result.release.apiVersion).toBe(ADAPTER_API_VERSION)
    expect(result.release.tarballUrl).toBe(`${baseUrl}/tarballs/good.tgz`)
    expect(result.release.dist.integrity).toBe(goodSri)
  })

  test('a newer positional 0.0 release is skipped for an older supported one', async () => {
    packuments.set('positional-newer', {
      versions: {
        '1.0.0': { api: ADAPTER_API_VERSION },
        '2.0.0': { api: '0.0' },
      },
    })
    const result = await resolveNpmAdapter('positional-newer', implicit, opts())
    if (!result.ok) expect.unreachable()
    expect(result.release.version).toBe('1.0.0')
  })

  test('wildcard selector constrains compatible selection', async () => {
    packuments.set('wildcarded', {
      versions: {
        '1.0.0': { api: ADAPTER_API_VERSION },
        '1.2.0': { api: ADAPTER_API_VERSION },
        '2.0.0': { api: ADAPTER_API_VERSION },
      },
    })
    const result = await resolveNpmAdapter(
      'wildcarded',
      { kind: 'selector', spec: { kind: 'majorWildcard', major: 1 }, raw: '1.*' },
      opts(),
    )
    if (!result.ok) expect.unreachable()
    expect(result.release.version).toBe('1.2.0')
  })

  test('explicit latest selects highest compatible independently of the latest dist-tag', async () => {
    packuments.set('tagged', {
      distTags: { latest: '3.0.0' },
      versions: {
        '2.5.0': { api: ADAPTER_API_VERSION },
        '3.0.0': { api: '9.9' },
      },
    })
    const result = await resolveNpmAdapter(
      'tagged',
      { kind: 'selector', spec: { kind: 'latest' }, raw: 'latest' },
      opts(),
    )
    if (!result.ok) expect.unreachable()
    // dist-tags.latest points at incompatible 3.0.0; selection ignores it.
    expect(result.release.version).toBe('2.5.0')
  })

  test('prerelease versions are excluded from consideration', async () => {
    packuments.set('prereleased', {
      versions: {
        '1.0.0': { api: ADAPTER_API_VERSION },
        '2.0.0-rc.1': { api: ADAPTER_API_VERSION },
      },
    })
    const result = await resolveNpmAdapter('prereleased', implicit, opts())
    if (!result.ok) expect.unreachable()
    expect(result.release.version).toBe('1.0.0')
  })

  test('exact request selects exactly that compatible release', async () => {
    packuments.set('pinned', {
      versions: {
        '1.0.0': { api: ADAPTER_API_VERSION },
        '1.1.0': { api: ADAPTER_API_VERSION },
      },
    })
    const result = await resolveNpmAdapter(
      'pinned',
      { kind: 'exact', major: 1, minor: 0, patch: 0, raw: '1.0.0' },
      opts(),
    )
    if (!result.ok) expect.unreachable()
    expect(result.release.version).toBe('1.0.0')
  })
})

describe('resolveNpmAdapter — incompatibility failures', () => {
  test('exact incompatible release fails without substitution', async () => {
    packuments.set('exact-incompatible', {
      versions: {
        '1.0.0': { api: ADAPTER_API_VERSION },
        '2.0.0': { api: '9.9' },
      },
    })
    const request: NpmVersionRequest = { kind: 'exact', major: 2, minor: 0, patch: 0, raw: '2.0.0' }
    const result = await resolveNpmAdapter('exact-incompatible', request, opts())
    if (result.ok) expect.unreachable()
    if (result.reason !== 'no-compatible-release') expect.unreachable()
    expect(result.request).toEqual(request)
    expect(result.supported).toEqual(SUPPORTED_ADAPTER_APIS)
    expect(result.newestConsidered).toEqual({ version: '2.0.0', declared: { kind: 'unsupported', api: '9.9' } })
  })

  test('missing package declaration makes a release ineligible', async () => {
    packuments.set('undeclared', {
      versions: {
        '1.0.0': {},
        '0.9.0': { api: ADAPTER_API_VERSION },
      },
    })
    const result = await resolveNpmAdapter('undeclared', implicit, opts())
    if (!result.ok) expect.unreachable()
    expect(result.release.version).toBe('0.9.0')
  })

  test('malformed package declaration makes a release ineligible', async () => {
    packuments.set('malformed', {
      versions: {
        '1.0.0': { api: '0.0.1' },
      },
    })
    const result = await resolveNpmAdapter('malformed', implicit, opts())
    if (result.ok) expect.unreachable()
    if (result.reason !== 'no-compatible-release') expect.unreachable()
    expect(result.newestConsidered).toEqual({ version: '1.0.0', declared: { kind: 'malformed', found: '0.0.1' } })
  })

  test('no release satisfying the selector reports no newestConsidered', async () => {
    packuments.set('sparse', {
      versions: { '1.0.0': { api: ADAPTER_API_VERSION } },
    })
    const result = await resolveNpmAdapter(
      'sparse',
      { kind: 'selector', spec: { kind: 'majorWildcard', major: 5 }, raw: '5.*' },
      opts(),
    )
    if (result.ok) expect.unreachable()
    if (result.reason !== 'no-compatible-release') expect.unreachable()
    expect(result.newestConsidered).toBeUndefined()
  })

  test('all-undeclared package reports the newest considered release as missing', async () => {
    packuments.set('legacy-only', {
      versions: {
        '1.0.0': {},
        '1.2.0': {},
      },
    })
    const result = await resolveNpmAdapter('legacy-only', implicit, opts())
    if (result.ok) expect.unreachable()
    if (result.reason !== 'no-compatible-release') expect.unreachable()
    expect(result.newestConsidered).toEqual({ version: '1.2.0', declared: { kind: 'missing' } })
  })
})

describe('resolveNpmAdapter — metadata failures', () => {
  test('http failure surfaces as metadata-fetch-failed', async () => {
    const result = await resolveNpmAdapter('never-published', implicit, opts())
    if (result.ok) expect.unreachable()
    if (result.reason !== 'metadata-fetch-failed') expect.unreachable()
    expect(result.status).toBe(404)
  })

  test('unparseable packument surfaces as metadata-invalid', async () => {
    packuments.set('broken-json', { versions: {} })
    const result = await resolveNpmAdapter('broken-json', implicit, opts())
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('metadata-invalid')
  })

  test('packument without versions surfaces as metadata-invalid', async () => {
    packuments.set('no-versions', { versions: {} })
    const result = await resolveNpmAdapter('no-versions', implicit, opts())
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('metadata-invalid')
  })

  test('selected release without a tarball surfaces as metadata-invalid', async () => {
    packuments.set('distless', {
      versions: { '1.0.0': { api: ADAPTER_API_VERSION, noDist: true } },
    })
    const result = await resolveNpmAdapter('distless', implicit, opts())
    if (result.ok) expect.unreachable()
    if (result.reason !== 'metadata-invalid') expect.unreachable()
    expect(result.detail).toContain('1.0.0')
  })

  test('unreachable registry surfaces as metadata-network-error', async () => {
    const result = await resolveNpmAdapter('any-package', implicit, {
      registryBaseUrl: 'https://registry.test',
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof globalThis.fetch,
    })
    if (result.ok) expect.unreachable()
    if (result.reason !== 'metadata-network-error') expect.unreachable()
    expect(result.cause).toContain('fetch failed')
  })
})

describe('downloadNpmRelease — integrity provenance', () => {
  test('download verifies SRI and reports the anchor used', async () => {
    packuments.set('sri-download', { versions: { '1.0.0': { api: ADAPTER_API_VERSION } } })
    const resolved = await resolveNpmAdapter('sri-download', implicit, opts())
    if (!resolved.ok) expect.unreachable()
    const dl = await downloadNpmRelease(resolved.release)
    if (!dl.ok) expect.unreachable()
    expect(dl.usedIntegrity).toEqual({ kind: 'sri', value: goodSri })
    expect(await Bun.file(`${dl.path}/package.json`).exists()).toBe(true)
  })

  test('download falls back to shasum and reports the anchor used', async () => {
    packuments.set('shasum-download', {
      versions: { '1.0.0': { api: ADAPTER_API_VERSION, useShasumOnly: true } },
    })
    const resolved = await resolveNpmAdapter('shasum-download', implicit, opts())
    if (!resolved.ok) expect.unreachable()
    const dl = await downloadNpmRelease(resolved.release)
    if (!dl.ok) expect.unreachable()
    expect(dl.usedIntegrity).toEqual({ kind: 'shasum', value: goodShasum })
  })

  test('corrupted integrity fails the download', async () => {
    packuments.set('tampered', {
      versions: { '1.0.0': { api: ADAPTER_API_VERSION, corruptIntegrity: true } },
    })
    const resolved = await resolveNpmAdapter('tampered', implicit, opts())
    if (!resolved.ok) expect.unreachable()
    const dl = await downloadNpmRelease(resolved.release)
    if (dl.ok) expect.unreachable()
    expect(dl.reason).toBe('integrity-mismatch')
  })

  test('release without integrity anchors refuses to install', async () => {
    packuments.set('anchorless', {
      versions: { '1.0.0': { api: ADAPTER_API_VERSION, noIntegrity: true } },
    })
    const resolved = await resolveNpmAdapter('anchorless', implicit, opts())
    if (!resolved.ok) expect.unreachable()
    const dl = await downloadNpmRelease(resolved.release)
    if (dl.ok) expect.unreachable()
    expect(dl.reason).toBe('integrity-missing')
  })
})
