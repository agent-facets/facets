import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as engine from '@agent-facets/engine'
import { writeCredentialsToken } from '@agent-facets/engine'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { run } from '../../../run.ts'

const realLogoutCliSession = engine.logoutCliSession
let logoutBehavior: typeof realLogoutCliSession = realLogoutCliSession
let logoutOptions: Array<{ localOnly?: boolean }> = []
let restoreLogout = () => {}

const { logoutCommand } = await import('../index.ts')

const ORIGINAL_TOKEN = process.env.FACET_TOKEN
const ORIGINAL_FACET_DIR = process.env.FACET_DIR
const ORIGINAL_REGISTRY_URL = process.env.FACET_REGISTRY_URL

let facetDir: string
const credentialsPath = () => join(facetDir, 'credentials')

beforeEach(() => {
  facetDir = mkdtempSync(join(tmpdir(), 'facet-logout-test-'))
  process.env.FACET_DIR = facetDir
  delete process.env.FACET_TOKEN
  process.env.FACET_REGISTRY_URL = 'https://api.test'
  logoutBehavior = realLogoutCliSession
  logoutOptions = []
  const mocked = spyOn(engine, 'logoutCliSession').mockImplementation(async (options = {}) => {
    logoutOptions.push(options)
    return logoutBehavior(options)
  })
  restoreLogout = () => mocked.mockRestore()
})

afterEach(() => {
  restoreLogout()
  rmSync(facetDir, { recursive: true, force: true })
  restore('FACET_TOKEN', ORIGINAL_TOKEN)
  restore('FACET_DIR', ORIGINAL_FACET_DIR)
  restore('FACET_REGISTRY_URL', ORIGINAL_REGISTRY_URL)
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe('logoutCommand', () => {
  test('FACET_TOKEN alone makes no WorkOS call and leaves OAuth state bytes untouched', async () => {
    process.env.FACET_TOKEN = 'fct_pub_env_canary'
    const oauthDir = join(facetDir, 'oauth')
    mkdirSync(oauthDir)
    const selectedHash = createHash('sha256').update('https://api.test').digest('hex')
    const sentinel = join(oauthDir, `${selectedHash}.json`)
    writeFileSync(sentinel, 'oauth-state-canary')
    let requests = 0
    const originalFetch = globalThis.fetch
    const fetcher = async (): Promise<Response> => {
      requests++
      return new Response('unexpected request', { status: 500 })
    }
    globalThis.fetch = Object.assign(fetcher, { preconnect: originalFetch.preconnect })
    try {
      const { result, stdout } = await captureStdout(() => logoutCommand.run([], {}))
      expect(result).toBe(0)
      expect(stdout).toContain('FACET_TOKEN is still set')
      expect(requests).toBe(0)
      expect(readFileSync(sentinel, 'utf8')).toBe('oauth-state-canary')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('selected browser logout distinguishes confirmed revocation from explicit local cleanup', async () => {
    logoutBehavior = async () => ({ ok: true, value: { source: 'oauth', remoteRevocation: 'confirmed' } })
    const remote = await captureStdout(() => logoutCommand.run([], {}))
    expect(remote.result).toBe(0)
    expect(remote.stdout).toContain('revoked')
    expect(remote.stdout).not.toContain('could not be confirmed')
    expect(logoutOptions).toEqual([{ localOnly: false }])

    logoutBehavior = async () => ({ ok: true, value: { source: 'oauth', remoteRevocation: 'unverified' } })
    const local = await captureStdout(() => run(['logout', '--local'], { logout: logoutCommand }))
    expect(local.result).toBe(0)
    expect(local.stdout).toContain('Remote sign-out could not be confirmed')
    expect(logoutOptions.at(-1)).toEqual({ localOnly: true })
  })

  test('transient browser logout failure exits nonzero without claiming sign-out or printing secrets', async () => {
    logoutBehavior = async () => ({ ok: false, error: { code: 'REFRESH_UNAVAILABLE', reason: 'transient' } })
    const { result: captured, stderr } = await captureStderr(() => captureStdout(() => logoutCommand.run([], {})))
    expect(captured.result).toBe(1)
    expect(captured.stdout).not.toContain('Signed out')
    expect(stderr).toContain('sign-in')
    expect(stderr).not.toContain('oauth-state-canary')
  })

  test('removes the saved credentials file and reports it', async () => {
    writeCredentialsToken('fct_pub_abc')
    expect(existsSync(credentialsPath())).toBe(true)

    const { result, stdout } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('Signed out')
    expect(stdout).toContain('any saved browser session remains')
    expect(existsSync(credentialsPath())).toBe(false)
  })

  test('reports plainly when there was nothing to remove', async () => {
    const { result, stdout } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('No saved credential to remove')
  })

  test('warns that FACET_TOKEN is still active after removing the file', async () => {
    writeCredentialsToken('fct_pub_abc')
    process.env.FACET_TOKEN = 'fct_pub_envtoken'

    const { result, stdout } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('FACET_TOKEN is still set')
    expect(stdout).toContain('unset FACET_TOKEN')
  })

  test('makes no network call (no fetch needed)', async () => {
    // Sanity: logout must not touch the network. We assert indirectly by
    // running with no fetch stub and confirming success.
    writeCredentialsToken('fct_pub_abc')
    const { result } = await captureStdout(() => logoutCommand.run([], {}))
    expect(result).toBe(0)
  })
})
