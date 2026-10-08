/**
 * Tests for the wire→internal metadata mapping guard (W4).
 *
 * The generated OpenAPI types declare `content_hash` and
 * `content_integrity` as required strings, but `openapi-fetch` performs
 * no response validation — a stale CDN-cached pre-migration metadata
 * object can deserialize with either field missing. The mapping must
 * fail closed (structured contract violation), never propagate
 * `undefined` into the integrity chain, and never fall back to the
 * other hash.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

// Installation tests retain module mocks across files. The authentication contracts run in a clean subprocess.
const realModule: typeof import('../resolve-metadata.ts') = await import(
  new URL('../resolve-metadata.ts?consumer-contract', import.meta.url).href
)
const { MAX_REGISTRY_METADATA_SPECIFIERS, metadataFromWire } = realModule

import type { RegistrySpec } from '../types.ts'

const VALID = {
  name: 'cowsay',
  version: '0.0.1',
  content_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  content_integrity: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
}

/** The request `VALID` is the response to. */
const REQUESTED: RegistrySpec = {
  name: 'cowsay',
  version: { kind: 'exact', major: 0, minor: 0, patch: 1 },
}

describe('metadataFromWire — runtime guard on the two hash fields', () => {
  test('maps a conforming body to domain-explicit names', () => {
    const result = metadataFromWire(VALID, REQUESTED)
    if (!result.ok) expect.unreachable()
    expect(result.value).toEqual({
      name: 'cowsay',
      version: '0.0.1',
      transportHash: VALID.content_hash,
      contentFingerprint: VALID.content_integrity,
    })
  })

  test('fails closed when content_integrity is missing (stale CDN shape)', () => {
    const stale = { ...VALID, content_integrity: undefined } as unknown as typeof VALID
    const result = metadataFromWire(stale, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('content_integrity')
    expect(result.error.cause).toContain('cowsay@0.0.1')
  })

  test('fails closed when content_integrity is an empty string', () => {
    const result = metadataFromWire({ ...VALID, content_integrity: '' }, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test('fails closed when content_hash is missing', () => {
    const stale = { ...VALID, content_hash: undefined } as unknown as typeof VALID
    const result = metadataFromWire(stale, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('content_hash')
  })

  test('fails closed when a hash field is a non-string value', () => {
    const mangled = { ...VALID, content_integrity: 42 } as unknown as typeof VALID
    const result = metadataFromWire(mangled, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })
})

describe('metadataFromWire — checking the response against the request', () => {
  test('refuses a body describing a different facet', () => {
    const result = metadataFromWire({ ...VALID, name: 'not-cowsay' }, REQUESTED)
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('cowsay')
  })

  test('refuses a missing or non-string name', () => {
    const nameless = { ...VALID, name: undefined } as unknown as typeof VALID
    const result = metadataFromWire(nameless, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test.each(['latest', '1.2', '1.*', '', 'v1.0.0'])('refuses the non-exact resolved version %p', (version) => {
    const result = metadataFromWire({ ...VALID, version }, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test('accepts a wildcard request answered with an exact version', () => {
    // The whole point of a wildcard: the server picks. What it picks
    // still has to be a concrete release.
    const result = metadataFromWire(
      { ...VALID, version: '3.1.4' },
      {
        name: 'cowsay',
        version: { kind: 'majorWildcard', major: 3 },
      },
    )
    if (!result.ok) expect.unreachable()
    expect(result.value.version).toBe('3.1.4')
  })

  test('does not check that the version satisfies the request', () => {
    // Range satisfaction is the caller's question, answered in discovery
    // where the authored specifier and its meaning are known.
    const result = metadataFromWire(
      { ...VALID, version: '9.9.9' },
      {
        name: 'cowsay',
        version: { kind: 'majorWildcard', major: 1 },
      },
    )
    expect(result.ok).toBe(true)
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

const realConsumer = realModule.resolveRegistryMetadataBatch
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
  describe('resolveRegistryMetadataBatch — resolved authentication', () => {
    test('OAuth metadata pins the selected origin and enforces its fetch policy', async () => {
      await seedOAuth()
      const requests: Request[] = []
      stubRequests((request, init) => {
        requests.push(request)
        const url = new URL(request.url)
        expect(url.origin).toBe(REGISTRY)
        if (url.pathname === '/v0/auth/cli/config') return json(CONFIG)
        if (url.pathname === '/v0/auth/me') {
          process.env.FACET_REGISTRY_URL = 'https://hostile.example'
          return json(PROFILE)
        }
        expect(url.pathname).toBe('/v0/facets/cowsay/0.0.1')
        expect(request.headers.get('authorization')).toBe('Bearer oauth-private-read')
        expect(request.headers.get('cookie')).toBeNull()
        expect(request.redirect).toBe('error')
        expect(init?.credentials).toBe('omit')
        return json(VALID)
      })
      const result = await realConsumer([REQUESTED])
      if (!result.ok) expect.unreachable()
      expect(result.value[0]?.name).toBe('cowsay')
      expect(requests).toHaveLength(3)
    })

    test('expired refresh failure returns authentication error without metadata I/O', async () => {
      await seedOAuth(true)
      const paths: string[] = []
      stubRequests((request) => {
        paths.push(new URL(request.url).pathname)
        if (paths.at(-1) === '/v0/auth/cli/config') return json(CONFIG)
        expect(request.url).toBe(BINDING.token_endpoint)
        return json({ error: 'invalid_grant' }, 400)
      })
      const result = await realConsumer([REQUESTED])
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
        return json(VALID)
      })
      const result = await realConsumer([REQUESTED])
      if (result.ok) expect.unreachable()
      if (result.error.code !== 'AUTHENTICATION_ERROR') expect.unreachable()
      expect(result.error.reason.code).toBe('PAT_UNREADABLE')
      expect(calls).toBe(0)
    })

    test.each([
      'env',
      'file',
      'absent',
    ])('%s preserves legacy metadata headers and selected registry', async (source) => {
      await seedOAuth()
      if (source === 'env') process.env.FACET_TOKEN = ' env-pat '
      if (source === 'file') writeCredentialsToken('file-pat')
      if (source === 'absent') rmSync(join(facetDir, 'oauth'), { recursive: true, force: true })
      let calls = 0
      stubRequests((request) => {
        calls++
        expect(request.url).toBe(`${REGISTRY}/v0/facets/cowsay/0.0.1`)
        expect(request.headers.get('authorization')).toBe(source === 'absent' ? null : `Bearer ${source}-pat`)
        return json(VALID)
      })
      const result = await realConsumer([REQUESTED])
      if (!result.ok) expect.unreachable()
      expect(calls).toBe(1)
    })

    test('empty and oversized batches return before unreadable credentials or any fetch', async () => {
      mkdirSync(join(facetDir, 'credentials'))
      let calls = 0
      stubRequests(() => {
        calls++
        return json(VALID)
      })
      expect(await realConsumer([])).toEqual({ ok: true, value: [] })
      expect(await realConsumer(Array.from({ length: MAX_REGISTRY_METADATA_SPECIFIERS + 1 }, () => REQUESTED))).toEqual(
        {
          ok: false,
          error: {
            code: 'TOO_MANY_SPECIFIERS',
            limit: MAX_REGISTRY_METADATA_SPECIFIERS,
            received: MAX_REGISTRY_METADATA_SPECIFIERS + 1,
          },
        },
      )
      expect(calls).toBe(0)
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
