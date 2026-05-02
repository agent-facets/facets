import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { publishCommand } from '../index.ts'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_KEY = process.env.FACET_REGISTRY_API_KEY
const ORIGINAL_URL = process.env.FACET_REGISTRY_URL

let projectRoot: string
let originalCwd: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-publish-test-'))
  originalCwd = process.cwd()
  process.chdir(projectRoot)
  process.env.FACET_REGISTRY_URL = 'https://api.test/v0'
  process.env.FACET_REGISTRY_API_KEY = 'test-key'
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(projectRoot, { recursive: true, force: true })
  globalThis.fetch = ORIGINAL_FETCH
  if (ORIGINAL_KEY === undefined) delete process.env.FACET_REGISTRY_API_KEY
  else process.env.FACET_REGISTRY_API_KEY = ORIGINAL_KEY
  if (ORIGINAL_URL === undefined) delete process.env.FACET_REGISTRY_URL
  else process.env.FACET_REGISTRY_URL = ORIGINAL_URL
})

function writeManifest(version: string): void {
  writeFileSync(
    join(projectRoot, 'facet.json'),
    JSON.stringify({
      name: 'cowsay',
      version,
      commands: { cowsay: { description: 'ascii cow' } },
    }),
  )
  mkdirSync(join(projectRoot, 'commands'), { recursive: true })
  writeFileSync(join(projectRoot, 'commands/cowsay.md'), '# cowsay\n')
}

describe('publishCommand', () => {
  test('happy path: publishes the on-disk version verbatim, returns 0 on 201', async () => {
    writeManifest('0.1.0')
    let calledUrl = ''
    let calledHeaders: Record<string, string> = {}
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(input)
      calledHeaders = init?.headers as Record<string, string>
      return new Response(JSON.stringify({}), { status: 201 })
    }) as unknown as typeof fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([], {}))
    expect(result).toBe(0)
    expect(calledUrl).toBe('https://api.test/v0/packages/cowsay/versions')
    expect(calledHeaders['x-api-key']).toBe('test-key')
    expect(calledHeaders['content-type']).toBe('application/gzip')
    expect(stdout).toContain('Published cowsay@0.1.0')
    // Manifest on disk MUST NOT be mutated by publish.
    const updated = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(updated.version).toBe('0.1.0')
  })

  test('namespaced facet: URL-encodes the slash', async () => {
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify({ name: 'acme/cowsay', version: '0.1.0' }))
    let calledUrl = ''
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrl = String(input)
      return new Response('{}', { status: 201 })
    }) as unknown as typeof fetch

    await captureStdout(() => publishCommand.run([], {}))
    expect(calledUrl).toBe('https://api.test/v0/packages/acme%2Fcowsay/versions')
  })

  test('missing API key: fails before any HTTP call and does not touch disk', async () => {
    writeManifest('0.1.0')
    delete process.env.FACET_REGISTRY_API_KEY
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      return new Response('{}', { status: 201 })
    }) as unknown as typeof fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    expect(attempts).toBe(0)
    expect(stderr).toContain('FACET_REGISTRY_API_KEY')
    expect(stderr).toContain('docs:')
    const v = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(v.version).toBe('0.1.0')
  })

  test('no facet.json: clean error', async () => {
    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('no facet.json')
  })

  test('413 (tarball too large): translates to clean error', async () => {
    writeManifest('0.1.0')
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: 'tarball exceeds the 5 MB size limit',
          code: 'E_TARBALL_TOO_LARGE',
          docsUrl: 'https://agentfacets.io/errors/E_TARBALL_TOO_LARGE',
        }),
        { status: 413 },
      )) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('exceeds size limit')
    expect(stderr).toContain('5 MB')
  })

  test('409 VERSION_EXISTS: surfaces a clean error pointing at manual bump, no retry, no mutation', async () => {
    writeManifest('0.1.0')
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      return new Response(
        JSON.stringify({
          error: 'version 0.1.0 already exists',
          code: 'VERSION_EXISTS',
          docsUrl: 'https://agentfacets.io/errors/VERSION_EXISTS',
        }),
        { status: 409 },
      )
    }) as unknown as typeof fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    // Exactly one attempt — no auto-retry-with-rebump.
    expect(attempts).toBe(1)
    expect(stderr).toContain('version 0.1.0 already exists')
    expect(stderr).toContain('bump `version` in facet.json')
    // facet.json must be untouched.
    const v = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(v.version).toBe('0.1.0')
  })

  test('network failure: surfaces clean error and does not mutate facet.json', async () => {
    writeManifest('0.1.0')
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('registry temporarily unavailable')
    const v = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(v.version).toBe('0.1.0')
  })

  test('positional args are rejected', async () => {
    const { result, stderr } = await captureStderr(() => publishCommand.run(['extra'], {}))
    expect(result).toBe(1)
    expect(stderr).toContain('does not accept positional arguments')
  })
})
