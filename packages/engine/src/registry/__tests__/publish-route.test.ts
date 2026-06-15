/**
 * Route-shape tests for `publishFacetVersion`.
 *
 * Scoped facet names MUST publish through the registry's two-segment scoped
 * route (`/v0/facets/{scope}/{name}/versions`) so the scope `/` stays a
 * literal path separator. Unscoped names keep the single-`{name}` route.
 * These tests stub `fetch` and assert on the request URL shape.
 */

import { describe, expect, test } from 'bun:test'
import { createRegistryClient } from '../client.ts'
import { publishResponse } from '../fixtures.ts'
import { publishFacetVersion } from '../publish.ts'

function asFetch(
  fn: (input: Request | string | URL, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  return fn as unknown as typeof globalThis.fetch
}

const BASE_URL = 'https://api.test'

function stubPublish(): { urls: string[]; fetch: typeof globalThis.fetch } {
  const urls: string[] = []
  const fetch = asFetch(async (input) => {
    urls.push(input instanceof Request ? input.url : String(input))
    return new Response(JSON.stringify(publishResponse()), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { urls, fetch }
}

describe('publishFacetVersion — route selection', () => {
  test('unscoped name posts to the single-{name} versions route', async () => {
    const { urls, fetch } = stubPublish()
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch })
    const result = await publishFacetVersion(client, { name: 'cowsay', tarball: new Uint8Array([1, 2, 3]) })
    expect(result.ok).toBe(true)
    expect(urls[0]).toBe('https://api.test/v0/facets/cowsay/versions')
  })

  test('scoped name posts to the two-segment scoped versions route (no %2F)', async () => {
    const { urls, fetch } = stubPublish()
    const client = createRegistryClient({ baseUrl: BASE_URL, fetch })
    const result = await publishFacetVersion(client, {
      name: '@julian/cowsay',
      tarball: new Uint8Array([1, 2, 3]),
    })
    expect(result.ok).toBe(true)
    expect(urls[0]).toBe('https://api.test/v0/facets/%40julian/cowsay/versions')
    expect(urls[0]).not.toContain('%2F')
  })
})
