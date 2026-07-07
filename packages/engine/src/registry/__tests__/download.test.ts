/**
 * Tests for the archive-URL resolution path in `download.ts`.
 *
 * Focus: a registry rejection on the archive-lookup request (401/403/
 * 5xx) must surface the registry's structured envelope verbatim
 * (`REGISTRY_REJECTED`) rather than being flattened into a generic
 * `NETWORK_ERROR`. This is the regression guard for the bug where the
 * archive path — the one read that reads the raw `Response` for the 302
 * `Location` header instead of a typed body — diverged from the
 * verbatim-error model that every other registry call site follows.
 *
 * `resolveArchiveUrl` takes an injected `client`, so we drive it with a
 * `createRegistryClient({ fetch })` stub, the same seam `client.test.ts`
 * uses.
 */

import { describe, expect, test } from 'bun:test'
import { createRegistryClient } from '../client.ts'
import { resolveArchiveUrl } from '../download.ts'
import { apiError } from '../fixtures.ts'
import type { RegistryMetadata } from '../types.ts'

const BASE_URL = 'https://api.test/v0'

const META: RegistryMetadata = {
  name: 'cowsay',
  version: '0.1.1',
  transportHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  contentFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
}

/**
 * Wrap a stub so it satisfies Bun's `typeof fetch` (which includes
 * `preconnect`) without each test repeating the cast.
 */
function asFetch(
  fn: (input: Request | string | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return fn as unknown as typeof globalThis.fetch
}

describe('resolveArchiveUrl — registry rejections render verbatim', () => {
  test('403 with a structured envelope yields REGISTRY_REJECTED (verbatim), not NETWORK_ERROR', async () => {
    const envelope = apiError({
      code: 'E_UNAUTHENTICATED',
      error: 'this facet version is awaiting review',
      fix: 'wait for an admin to approve it, or contact support',
      docs_url: 'https://docs.agentfacets.io/errors/E_FORBIDDEN',
    })
    const stubFetch = asFetch(
      async () =>
        new Response(JSON.stringify(envelope), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })

    const result = await resolveArchiveUrl(client, META)

    if (result.ok) expect.unreachable()
    if (result.error.code !== 'REGISTRY_REJECTED') expect.unreachable()
    expect(result.error.wireCode).toBe('E_UNAUTHENTICATED')
    expect(result.error.error).toBe('this facet version is awaiting review')
    expect(result.error.fix).toBe('wait for an admin to approve it, or contact support')
    expect(result.error.docsUrl).toBe('https://docs.agentfacets.io/errors/E_FORBIDDEN')
  })

  test('500 with a structured envelope yields REGISTRY_REJECTED, not NETWORK_ERROR', async () => {
    const envelope = apiError({
      code: 'E_REGISTRY_UNAVAILABLE',
      error: 'something went wrong on our end',
      fix: 'try again in a few minutes',
      docs_url: 'https://docs.agentfacets.io/errors/E_INTERNAL',
    })
    const stubFetch = asFetch(
      async () =>
        new Response(JSON.stringify(envelope), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })

    const result = await resolveArchiveUrl(client, META)

    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('REGISTRY_REJECTED')
  })

  test('non-JSON error body yields UNPARSEABLE_RESPONSE keyed off the status', async () => {
    const stubFetch = asFetch(
      async () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    )
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })

    const result = await resolveArchiveUrl(client, META)

    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNPARSEABLE_RESPONSE') expect.unreachable()
    expect(result.error.status).toBe(502)
  })

  test('404 still yields NOT_FOUND with the requested name and version', async () => {
    const stubFetch = asFetch(
      async () =>
        new Response(JSON.stringify(apiError({ error: 'no such facet', fix: 'check the name', docs_url: 'x' })), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })

    const result = await resolveArchiveUrl(client, META)

    if (result.ok) expect.unreachable()
    if (result.error.code !== 'NOT_FOUND') expect.unreachable()
    expect(result.error.name).toBe('cowsay')
    expect(result.error.spec).toBe('0.1.1')
  })

  test('302 with a Location header resolves to the presigned URL', async () => {
    const presigned = 'https://s3.test/cowsay-0.1.1.facet?sig=abc'
    const stubFetch = asFetch(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: presigned },
        }),
    )
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch: stubFetch })

    const result = await resolveArchiveUrl(client, META)

    if (!result.ok) expect.unreachable()
    expect(result.value).toBe(presigned)
  })
})
