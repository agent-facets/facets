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

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createRegistryClient } from '../client.ts'

// Installation tests retain module mocks across files. The authentication contracts run in a clean subprocess.
const realModule: typeof import('../download.ts') = await import(
  new URL('../download.ts?consumer-contract', import.meta.url).href
)
const { resolveArchiveUrl } = realModule

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
  return Object.assign(fn, { preconnect: globalThis.fetch.preconnect })
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

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCredentialsToken } from '../credentials.ts'
import {
  type OAuthSessionBinding,
  type ReadyOAuthSession,
  saveOAuthSession,
  withOAuthSessionLock,
} from '../oauth-store.ts'
import type { WireAuthMeResponse } from '../wire.ts'

const REGISTRY = 'https://registry.example'
const CLIENT_ID = 'client_01HZXYPJYQ8V7Z9M4G3K2N1P0R'
const BINDING: OAuthSessionBinding = {
  registry_origin: REGISTRY,
  client_id: CLIENT_ID,
  issuer: `https://api.workos.com/user_management/${CLIENT_ID}`,
  authorization_endpoint: 'https://api.workos.com/user_management/authorize/device',
  token_endpoint: 'https://api.workos.com/user_management/authenticate',
  verification_origin: 'https://login.example',
}
const CONFIG = {
  enabled: true,
  provider: 'workos',
  client_id: CLIENT_ID,
  issuer: BINDING.issuer,
  authorization_endpoint: BINDING.authorization_endpoint,
  token_endpoint: BINDING.token_endpoint,
  verification_origin: BINDING.verification_origin,
  onboarding_url: 'https://app.example/auth/onboarding',
}
const PROFILE = {
  user_uuid: 'registry-user',
  username: 'example',
  email: 'example@example.test',
  tier: 'free',
  suspended: false,
  startup_experience: { kind: 'landing-only' },
  getting_started: { kind: 'unavailable' },
} satisfies WireAuthMeResponse

const realConsumer = realModule.downloadAndExtractFacet
let facetDir: string
let originalEnv: { facetDir: string | undefined; token: string | undefined; registry: string | undefined }
let fetchSpy: { mockRestore(): void } | undefined

beforeEach(() => {
  originalEnv = {
    facetDir: process.env.FACET_DIR,
    token: process.env.FACET_TOKEN,
    registry: process.env.FACET_REGISTRY_URL,
  }
  facetDir = mkdtempSync(join(tmpdir(), 'facet-consumer-'))
  process.env.FACET_DIR = facetDir
  process.env.FACET_REGISTRY_URL = REGISTRY
  delete process.env.FACET_TOKEN
})

afterEach(() => {
  fetchSpy?.mockRestore()
  fetchSpy = undefined
  rmSync(facetDir, { recursive: true, force: true })
  for (const [key, value] of [
    ['FACET_DIR', originalEnv.facetDir],
    ['FACET_TOKEN', originalEnv.token],
    ['FACET_REGISTRY_URL', originalEnv.registry],
  ]) {
    if (key === undefined) expect.unreachable()
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function stubRequests(handler: (request: Request, init?: RequestInit) => Response | Promise<Response>): void {
  const fetcher = async (input: Request | string | URL, init?: RequestInit): Promise<Response> =>
    handler(input instanceof Request ? input : new Request(input.toString(), init), init)
  fetcher.preconnect = globalThis.fetch.preconnect
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(fetcher)
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

async function seedOAuth(expired = false): Promise<void> {
  const session: ReadyOAuthSession = {
    version: 1,
    ...BINDING,
    access_token: 'oauth-private-read',
    refresh_token: 'refresh-private-read',
    expires_at: Date.now() + (expired ? -60_000 : 3_600_000),
    subject: 'workos-user',
    session_id: 'session',
    user_uuid: PROFILE.user_uuid,
    generation: 1,
    status: 'ready',
  }
  const result = await withOAuthSessionLock(BINDING, (lock) => saveOAuthSession(session, null, lock))
  if (!result.ok) expect.unreachable()
}

if (process.env.FACET_CONSUMER_TEST_FILE === import.meta.path) {
  describe('downloadAndExtractFacet — resolved authentication', () => {
    test('OAuth archive lookup pins its origin and storage receives no bearer', async () => {
      await seedOAuth()
      const requests: Request[] = []
      stubRequests((request, init) => {
        requests.push(request)
        const url = new URL(request.url)
        if (url.pathname === '/v0/auth/cli/config') return json(CONFIG)
        if (url.pathname === '/v0/auth/me') {
          process.env.FACET_REGISTRY_URL = 'https://hostile.example'
          return json(PROFILE)
        }
        if (url.origin === REGISTRY) {
          expect(request.headers.get('authorization')).toBe('Bearer oauth-private-read')
          expect(request.redirect).toBe('manual')
          expect(init?.credentials).toBe('omit')
          expect(request.headers.get('cookie')).toBeNull()
          return new Response(null, { status: 302, headers: { location: 'https://storage.example/archive' } })
        }
        expect(url.origin).toBe('https://storage.example')
        expect(request.headers.get('authorization')).toBeNull()
        return new Response(null, { status: 404 })
      })
      const result = await realConsumer(META, join(facetDir, 'dest'))
      if (result.ok) expect.unreachable()
      expect(result.error.code).toBe('NOT_FOUND')
      expect(requests.map((request) => new URL(request.url).origin)).toEqual([
        REGISTRY,
        REGISTRY,
        REGISTRY,
        'https://storage.example',
      ])
    })

    test('expired refresh failure returns authentication error without archive or storage I/O', async () => {
      await seedOAuth(true)
      const paths: string[] = []
      stubRequests((request) => {
        paths.push(new URL(request.url).pathname)
        if (paths.at(-1) === '/v0/auth/cli/config') return json(CONFIG)
        expect(request.url).toBe(BINDING.token_endpoint)
        return json({ error: 'invalid_grant' }, 400)
      })
      const result = await realConsumer(META, join(facetDir, 'dest'))
      expect(result).toEqual({
        ok: false,
        error: { code: 'AUTHENTICATION_ERROR', reason: { code: 'REAUTHENTICATION_REQUIRED' } },
      })
      expect(paths).toEqual(['/v0/auth/cli/config', '/user_management/authenticate'])
    })

    test('unreadable PAT fails before resource I/O', async () => {
      mkdirSync(join(facetDir, 'credentials'))
      let calls = 0
      stubRequests(() => {
        calls++
        return new Response(null, { status: 404 })
      })
      const result = await realConsumer(META, join(facetDir, 'dest'))
      if (result.ok) expect.unreachable()
      if (result.error.code !== 'AUTHENTICATION_ERROR') expect.unreachable()
      expect(result.error.reason.code).toBe('PAT_UNREADABLE')
      expect(calls).toBe(0)
    })

    test.each([
      'env',
      'file',
      'absent',
    ])('%s preserves legacy archive headers and selected registry', async (source) => {
      await seedOAuth()
      if (source === 'env') process.env.FACET_TOKEN = ' env-pat '
      if (source === 'file') writeCredentialsToken('file-pat')
      if (source === 'absent') rmSync(join(facetDir, 'oauth'), { recursive: true, force: true })
      let calls = 0
      stubRequests((request) => {
        calls++
        expect(request.url).toBe(`${REGISTRY}/v0/facets/cowsay/0.1.1/archive`)
        expect(request.headers.get('authorization')).toBe(source === 'absent' ? null : `Bearer ${source}-pat`)
        return new Response(null, { status: 404 })
      })
      const result = await realConsumer(META, join(facetDir, 'dest'))
      if (result.ok) expect.unreachable()
      expect(result.error.code).toBe('NOT_FOUND')
      expect(calls).toBe(1)
    })
  })
} else {
  test('real consumer authentication contracts run without install-suite module mocks', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, FACET_CONSUMER_TEST_FILE: import.meta.path },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ exitCode, failureOutput: exitCode === 0 ? '' : stdout + stderr }).toEqual({
      exitCode: 0,
      failureOutput: '',
    })
  }, 30_000)
}
