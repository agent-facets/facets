import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WireAuthMeResponse } from '@agent-facets/engine'
import * as engine from '@agent-facets/engine'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'

const realResolveRegistryCredential = engine.resolveRegistryCredential
let resolveBehavior: typeof realResolveRegistryCredential = realResolveRegistryCredential
let restoreResolver = () => {}

const { whoamiCommand } = await import('../index.ts')

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_TOKEN = process.env.FACET_TOKEN
const ORIGINAL_FACET_DIR = process.env.FACET_DIR
const ORIGINAL_URL = process.env.FACET_REGISTRY_URL

let facetDir: string

beforeEach(() => {
  facetDir = mkdtempSync(join(tmpdir(), 'facet-whoami-test-'))
  process.env.FACET_DIR = facetDir
  process.env.FACET_REGISTRY_URL = 'https://api.test'
  process.env.FACET_TOKEN = 'fct_pub_testtoken'
  resolveBehavior = realResolveRegistryCredential
  const mocked = spyOn(engine, 'resolveRegistryCredential').mockImplementation((options) => resolveBehavior(options))
  restoreResolver = () => mocked.mockRestore()
})

afterEach(() => {
  restoreResolver()
  rmSync(facetDir, { recursive: true, force: true })
  globalThis.fetch = ORIGINAL_FETCH
  restore('FACET_TOKEN', ORIGINAL_TOKEN)
  restore('FACET_DIR', ORIGINAL_FACET_DIR)
  restore('FACET_REGISTRY_URL', ORIGINAL_URL)
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function stubProfile(): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        user_uuid: 'u-1',
        username: 'ada',
        email: 'ada@example.com',
        tier: 'pro',
        suspended: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch
}

describe('whoamiCommand', () => {
  test('prints the verified OAuth profile and frozen origin without another profile fetch', async () => {
    const profile = {
      user_uuid: 'u-oauth',
      username: 'oauth-ada',
      email: 'oauth-ada@example.com',
      tier: 'pro',
      suspended: false,
      startup_experience: { kind: 'landing-only' },
      getting_started: { kind: 'unavailable' },
    } satisfies WireAuthMeResponse
    const bearer = 'oauth-whoami-secret-canary'
    resolveBehavior = async () => {
      process.env.FACET_REGISTRY_URL = 'https://changed.invalid'
      return { ok: true, value: { source: 'oauth', token: bearer, registryOrigin: 'https://api.test', profile } }
    }
    let requests = 0
    const fetcher = async (): Promise<Response> => {
      requests++
      return new Response('unexpected profile fetch', { status: 500 })
    }
    globalThis.fetch = Object.assign(fetcher, { preconnect: ORIGINAL_FETCH.preconnect })

    const { result, stdout } = await captureStdout(() => whoamiCommand.run([], {}))
    expect(result).toBe(0)
    expect(requests).toBe(0)
    expect(stdout).toContain('oauth-ada <oauth-ada@example.com>')
    expect(stdout).toContain('registry: https://api.test')
    expect(stdout).toContain('credential: browser session')
    expect(stdout).not.toContain('changed.invalid')
    expect(stdout).not.toContain(bearer)
  })

  test('failed refresh cannot fall back to the environment token', async () => {
    resolveBehavior = async () => ({ ok: false, error: { code: 'REFRESH_UNAVAILABLE', reason: 'transient' } })
    let requests = 0
    const fetcher = async (): Promise<Response> => {
      requests++
      return new Response('unexpected profile fetch', { status: 500 })
    }
    globalThis.fetch = Object.assign(fetcher, { preconnect: ORIGINAL_FETCH.preconnect })
    const { result, stderr } = await captureStderr(() => whoamiCommand.run([], {}))
    expect(result).toBe(1)
    expect(requests).toBe(0)
    expect(stderr).toContain('sign-in')
    expect(stderr).not.toContain('fct_pub_testtoken')
  })

  test('prints the profile and names the env-var source when using FACET_TOKEN', async () => {
    stubProfile()
    const { result, stdout } = await captureStdout(() => whoamiCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('ada')
    expect(stdout).toContain('ada@example.com')
    expect(stdout).toContain('pro')
    expect(stdout).toContain('registry: https://api.test')
    expect(stdout).toContain('FACET_TOKEN')
  })

  test('falls back to the default registry URL when FACET_REGISTRY_URL is unset', async () => {
    delete process.env.FACET_REGISTRY_URL
    stubProfile()
    const { result, stdout } = await captureStdout(() => whoamiCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('registry: https://api.agentfacets.io')
  })

  test('does not name the env source when the credential comes from the file', async () => {
    delete process.env.FACET_TOKEN
    // Write a credentials file the resolver will read.
    const { writeCredentialsToken } = await import('@agent-facets/engine')
    writeCredentialsToken('fct_pub_filetoken')
    stubProfile()
    const { result, stdout } = await captureStdout(() => whoamiCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('ada')
    expect(stdout).not.toContain('FACET_TOKEN')
  })

  test('reports the suspended state', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          user_uuid: 'u-1',
          username: 'ada',
          email: 'ada@example.com',
          tier: 'free',
          suspended: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch
    const { stdout } = await captureStdout(() => whoamiCommand.run([], {}))
    expect(stdout).toContain('suspended')
  })

  test('not signed in: clean error and exit 1 when no credential resolves', async () => {
    delete process.env.FACET_TOKEN
    const { result, stderr } = await captureStderr(() => whoamiCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('not signed in')
    expect(stderr).toContain('facet login')
  })

  test('renders the registry error verbatim on a rejected token', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: 'your token has been revoked',
          code: 'E_TOKEN_REVOKED',
          fix: 'mint a new token in the web UI',
          docsUrl: 'https://agentfacets.io/errors/E_TOKEN_REVOKED',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => whoamiCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('your token has been revoked')
    expect(stderr).toContain('mint a new token in the web UI')
  })
})
