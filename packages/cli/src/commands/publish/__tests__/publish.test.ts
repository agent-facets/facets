import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { publishCommand } from '../index.ts'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_TOKEN = process.env.FACET_TOKEN
const ORIGINAL_FACET_DIR = process.env.FACET_DIR
const ORIGINAL_URL = process.env.FACET_REGISTRY_URL

let projectRoot: string
let facetDir: string
let originalCwd: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-publish-test-'))
  // Point FACET_DIR at an empty temp dir so the credential resolver
  // never reads a real on-disk credentials file; the env token is the
  // credential under test.
  facetDir = mkdtempSync(join(tmpdir(), 'facet-publish-home-'))
  originalCwd = process.cwd()
  process.chdir(projectRoot)
  process.env.FACET_REGISTRY_URL = 'https://api.test'
  process.env.FACET_DIR = facetDir
  process.env.FACET_TOKEN = 'fct_pub_testtoken'
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(facetDir, { recursive: true, force: true })
  globalThis.fetch = ORIGINAL_FETCH
  restoreEnv('FACET_TOKEN', ORIGINAL_TOKEN)
  restoreEnv('FACET_DIR', ORIGINAL_FACET_DIR)
  restoreEnv('FACET_REGISTRY_URL', ORIGINAL_URL)
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

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
  test('happy path: publishes the on-disk version with a Bearer token, returns 0 on 201', async () => {
    writeManifest('0.1.0')
    let calledUrl = ''
    let calledHeaders: Record<string, string> = {}
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const req =
        input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
      calledUrl = req.url
      calledHeaders = Object.fromEntries(req.headers.entries())
      return new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
        status: 201,
      })
    }) as unknown as typeof fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([], {}))
    expect(result).toBe(0)
    expect(calledUrl).toBe('https://api.test/v0/facets/cowsay/versions')
    expect(calledHeaders.authorization).toBe('Bearer fct_pub_testtoken')
    expect(calledHeaders['x-api-key']).toBeUndefined()
    expect(calledHeaders['content-type']).toBe('application/gzip')
    expect(stdout).toContain('Published cowsay@0.1.0')
    // Manifest on disk MUST NOT be mutated by publish.
    const updated = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(updated.version).toBe('0.1.0')
  })

  test('202 queued for review: treated as success, renders queue guidance, returns 0', async () => {
    writeManifest('0.1.0')
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          status: 'QUEUED_FOR_REVIEW',
          reason: 'reserved',
          fix: 'an admin will review your submission shortly',
          docsUrl: 'https://agentfacets.io/queue',
        }),
        { status: 202 },
      )) as unknown as typeof fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([], {}))
    expect(result).toBe(0)
    expect(stdout).toContain('submitted for review')
    expect(stdout).toContain('an admin will review your submission shortly')
  })

  test('namespaced facet: URL-encodes the slash', async () => {
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify({ name: 'acme/cowsay', version: '0.1.0' }))
    let calledUrl = ''
    globalThis.fetch = (async (input: string | URL | Request) => {
      const req = input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString())
      calledUrl = req.url
      return new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'acme/cowsay', version: '0.1.0' }), {
        status: 201,
      })
    }) as unknown as typeof fetch

    await captureStdout(() => publishCommand.run([], {}))
    expect(calledUrl).toBe('https://api.test/v0/facets/acme%2Fcowsay/versions')
  })

  test('no credential: fails before any HTTP call and does not touch disk', async () => {
    writeManifest('0.1.0')
    delete process.env.FACET_TOKEN
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      return new Response('{}', { status: 201 })
    }) as unknown as typeof fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    expect(attempts).toBe(0)
    expect(stderr).toContain('not signed in')
    expect(stderr).toContain('facet login')
    const v = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(v.version).toBe('0.1.0')
  })

  test('no facet.json in the target directory: clean error', async () => {
    // projectRoot is an empty temp dir (no manifest written).
    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr.toLowerCase()).toContain('facet.json')
  })

  test('413 (tarball too large): renders the registry error verbatim', async () => {
    writeManifest('0.1.0')
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: 'tarball exceeds the 5 MB size limit',
          code: 'E_TARBALL_TOO_LARGE',
          fix: 'reduce the facet contents below 5 MB or split into multiple facets',
          docsUrl: 'https://agentfacets.io/errors/E_TARBALL_TOO_LARGE',
        }),
        { status: 413 },
      )) as unknown as typeof fetch
    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    // Verbatim server text — no local code-to-message map.
    expect(stderr).toContain('tarball exceeds the 5 MB size limit')
    expect(stderr).toContain('reduce the facet contents below 5 MB')
  })

  test('409 E_VERSION_EXISTS: renders the registry error verbatim, no retry, no mutation', async () => {
    writeManifest('0.1.0')
    let attempts = 0
    globalThis.fetch = (async () => {
      attempts++
      return new Response(
        JSON.stringify({
          error: 'version 0.1.0 already exists',
          code: 'E_VERSION_EXISTS',
          fix: 'bump the version in facet.json and publish again',
          docsUrl: 'https://agentfacets.io/errors/E_VERSION_EXISTS',
        }),
        { status: 409 },
      )
    }) as unknown as typeof fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    // Exactly one attempt — no auto-retry-with-rebump.
    expect(attempts).toBe(1)
    // Server text rendered verbatim (both error and fix).
    expect(stderr).toContain('version 0.1.0 already exists')
    expect(stderr).toContain('bump the version in facet.json and publish again')
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
    expect(stderr).toContain('could not reach the registry')
    const v = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(v.version).toBe('0.1.0')
  })

  test('a directory argument targets that directory for publish', async () => {
    // Write the manifest into a SUBDIR, leave cwd (projectRoot) without
    // one, and publish by passing the subdir path — proving publish no
    // longer relies solely on cwd.
    const sub = join(projectRoot, 'nested')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'facet.json'), JSON.stringify({ name: 'cowsay', version: '0.1.0' }))
    let calledUrl = ''
    globalThis.fetch = (async (input: string | URL | Request) => {
      const req = input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString())
      calledUrl = req.url
      return new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
        status: 201,
      })
    }) as unknown as typeof fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([sub], {}))
    expect(result).toBe(0)
    expect(calledUrl).toBe('https://api.test/v0/facets/cowsay/versions')
    expect(stdout).toContain('Published cowsay@0.1.0')
  })

  test('a non-existent directory argument errors cleanly', async () => {
    const { result, stderr } = await captureStderr(() => publishCommand.run(['does-not-exist'], {}))
    expect(result).toBe(1)
    expect(stderr.toLowerCase()).toContain('directory does not exist')
  })
})
