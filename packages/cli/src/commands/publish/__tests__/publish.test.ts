import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArtifactPath } from '@agent-facets/engine'
import { parseFacetArchive } from '@agent-facets/protocol'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import { publishCommand } from '../index.ts'
import { buildFacetFixture, createFetchSpy } from './helpers.ts'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_TOKEN = process.env.FACET_TOKEN
const ORIGINAL_FACET_DIR = process.env.FACET_DIR
const ORIGINAL_URL = process.env.FACET_REGISTRY_URL

let projectRoot: string
let facetDir: string
let originalCwd: string

// Module mocks: these stub the interactive prompt helpers and the
// build-view trampoline so tests can assert end-to-end publish behavior
// without mounting Ink or simulating keystrokes. The mocks are mutated
// per-test via the exported setters below.
let mockBuildMissingAnswer: boolean = false
let mockRebuildDriftedAnswer: boolean = false
let mockIdentityDriftDecision: 'build-new' | 'ship-existing' | 'cancel' = 'cancel'
let mockRunBuildViewBehavior: (projectRoot: string) => Promise<{ ok: boolean }> = async () => ({ ok: false })

mock.module('../build-offer.ts', () => ({
  askToBuildMissing: async () => mockBuildMissingAnswer,
  askToRebuildDrifted: async () => mockRebuildDriftedAnswer,
  askIdentityDriftDecision: async (
    _source: { name: string; version: string },
    _artifact: { name: string; version: string },
  ) => mockIdentityDriftDecision,
}))

mock.module('../run-build-view.ts', () => ({
  runBuildViewAndCapture: async (projectRoot: string) => mockRunBuildViewBehavior(projectRoot),
}))

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
  // Reset mock state between tests
  mockBuildMissingAnswer = false
  mockRebuildDriftedAnswer = false
  mockIdentityDriftDecision = 'cancel'
  mockRunBuildViewBehavior = async () => ({ ok: false })
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

/**
 * Replace the runBuildView mock with a behavior that actually runs the
 * real build pipeline + writeBuildOutput, producing a real
 * `dist/<name>-<version>.facet` from whatever source is on disk. Used
 * by the "build offered and accepted" scenarios so the post-build
 * publish step has real bytes to verify.
 */
function mockRunBuildViewToActuallyBuild(): void {
  mockRunBuildViewBehavior = async (root) => {
    const { runBuildPipeline, writeBuildOutput } = await import('@agent-facets/engine')
    const result = await runBuildPipeline(root, [])
    if (!result.ok) return { ok: false }
    await writeBuildOutput(result, root)
    return { ok: true }
  }
}

describe('publishCommand — happy path', () => {
  test('built artifact matches source: verifies and uploads, returns 0', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n\nrender an ascii cow' },
    })
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([], {}))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    expect(call.url).toBe('https://api.test/v0/facets/cowsay/versions')
    expect(call.headers.authorization).toBe('Bearer fct_pub_testtoken')
    expect(call.headers['content-type']).toBe('application/gzip')
    // The uploaded body MUST be a valid two-layer .facet — parses
    // through the protocol's archive reader, has a build manifest.
    const parsed = parseFacetArchive(call.body)
    if (!parsed.ok) expect.unreachable()
    expect(parsed.data.buildManifest.archive).toBe('archive.tar.gz')
    expect(parsed.data.buildManifest.integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(stdout).toContain('Published cowsay@0.1.0')
  })
})

describe('publishCommand — missing artifact', () => {
  test('TTY, user accepts build offer: builds, uploads, returns 0', async () => {
    // Set up source files but no dist/ — this is the "never built"
    // case the build-offer is designed for.
    writeFileSync(
      join(projectRoot, 'facet.json'),
      JSON.stringify({
        name: 'cowsay',
        version: '0.1.0',
        commands: { cowsay: { description: 'ascii cow' } },
      }),
    )
    mkdirSync(join(projectRoot, 'commands'), { recursive: true })
    writeFileSync(join(projectRoot, 'commands/cowsay.md'), '# cowsay\n\nascii cow')
    mockBuildMissingAnswer = true
    mockRunBuildViewToActuallyBuild()
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch

    const { result } = await withTTY(true, () => captureStdout(() => publishCommand.run([], {})))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    const parsed = parseFacetArchive(call.body)
    if (!parsed.ok) expect.unreachable()
    expect(parsed.data.buildManifest.archive).toBe('archive.tar.gz')
  })

  test('TTY, user declines build offer: aborts non-zero, no fetch', async () => {
    writeFileSync(
      join(projectRoot, 'facet.json'),
      JSON.stringify({
        name: 'cowsay',
        version: '0.1.0',
        commands: { cowsay: { description: 'ascii cow' } },
      }),
    )
    mkdirSync(join(projectRoot, 'commands'), { recursive: true })
    writeFileSync(join(projectRoot, 'commands/cowsay.md'), '# cowsay\n')
    mockBuildMissingAnswer = false // decline
    const spy = createFetchSpy()
    globalThis.fetch = spy.fetch

    const { result, stderr } = await withTTY(true, () => captureStderr(() => publishCommand.run([], {})))

    expect(result).toBe(1)
    expect(spy.calls).toHaveLength(0)
    expect(stderr).toContain('nothing to publish')
  })

  test('non-TTY: fails non-zero with "facet build" hint, no fetch, no prompt', async () => {
    writeFileSync(
      join(projectRoot, 'facet.json'),
      JSON.stringify({
        name: 'cowsay',
        version: '0.1.0',
        commands: { cowsay: { description: 'ascii cow' } },
      }),
    )
    mkdirSync(join(projectRoot, 'commands'), { recursive: true })
    writeFileSync(join(projectRoot, 'commands/cowsay.md'), '# cowsay\n')
    const spy = createFetchSpy()
    globalThis.fetch = spy.fetch

    const { result, stderr } = await withTTY(false, () => captureStderr(() => publishCommand.run([], {})))

    expect(result).toBe(1)
    expect(spy.calls).toHaveLength(0)
    expect(stderr).toContain('no built artifact')
    expect(stderr).toContain('facet build')
  })
})

describe('publishCommand — content drift', () => {
  // Content drift: same name + version, different manifest content
  // (e.g., the user edited `description` without rebuilding). Two
  // options in TTY: rebuild and publish, or publish existing as-is.
  test('TTY, user accepts rebuild offer: rebuilds, uploads new', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      description: 'old description',
      commands: { cowsay: '# cowsay\n' },
    })
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as {
      description: string
    }
    manifest.description = 'new description'
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))
    mockRebuildDriftedAnswer = true
    mockRunBuildViewToActuallyBuild()
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch
    // Capture the original bytes before the rebuild so we can assert
    // the upload is the NEW bytes, not the old.
    const distPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.0')
    const originalBytes = new Uint8Array(await Bun.file(distPath).bytes())

    const { result } = await withTTY(true, () => captureStdout(() => publishCommand.run([], {})))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    // Uploaded bytes must differ from the original (rebuild produced new bytes
    // because the embedded facet.json now contains the new description).
    const rebuiltBytes = new Uint8Array(await Bun.file(distPath).bytes())
    expect(rebuiltBytes).not.toEqual(originalBytes)
    expect(call.body).toEqual(rebuiltBytes)
  })

  test('TTY, user declines rebuild offer: uploads existing drifted artifact', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      description: 'old description',
      commands: { cowsay: '# cowsay\n' },
    })
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as {
      description: string
    }
    manifest.description = 'new description'
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))
    mockRebuildDriftedAnswer = false // decline
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch
    const distPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.0')
    const originalBytes = new Uint8Array(await Bun.file(distPath).bytes())

    const { result } = await withTTY(true, () => captureStdout(() => publishCommand.run([], {})))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    // The uploaded body is the EXISTING (drifted) archive, unchanged.
    expect(call.body).toEqual(originalBytes)
  })

  test('non-TTY: warns to stderr and uploads existing drifted artifact, no prompt', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      description: 'old description',
      commands: { cowsay: '# cowsay\n' },
    })
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as {
      description: string
    }
    manifest.description = 'new description'
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch
    const distPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.0')
    const originalBytes = new Uint8Array(await Bun.file(distPath).bytes())

    const { result, stderr } = await withTTY(false, () => captureStderr(() => publishCommand.run([], {})))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    expect(stderr).toContain('out of date')
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    expect(call.body).toEqual(originalBytes)
  })
})

describe('publishCommand — identity drift', () => {
  // Identity drift: built artifact's embedded name OR version differs
  // from source. Three options in TTY: build new + publish, publish
  // existing as-is, or cancel. This is the version-bump-forgot-to-rebuild
  // case (e.g. the cowsay@0.1.2 → 0.1.3 situation that triggered D8).
  test('TTY, user chooses build-new: builds source, uploads new', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    // Bump version in source — dist/ now has cowsay-0.1.0.facet but source
    // says 0.1.1. Discovery finds the old artifact, comparator reports
    // identity drift (version differs).
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    manifest.version = '0.1.1'
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))
    mockIdentityDriftDecision = 'build-new'
    mockRunBuildViewToActuallyBuild()
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.1' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch

    const { result } = await withTTY(true, () => captureStdout(() => publishCommand.run([], {})))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    // The freshly built artifact at 0.1.1 was uploaded.
    const newDistPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.1')
    const newBytes = new Uint8Array(await Bun.file(newDistPath).bytes())
    expect(call.body).toEqual(newBytes)
    // Build-side invariant: writeBuildOutput purges dist/, so only the
    // new artifact should exist.
    const oldDistPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.0')
    expect(await Bun.file(oldDistPath).exists()).toBe(false)
  })

  test('TTY, user chooses ship-existing: uploads existing artifact under its embedded identity', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    manifest.version = '0.1.1'
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))
    mockIdentityDriftDecision = 'ship-existing'
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch
    const oldDistPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.0')
    const oldBytes = new Uint8Array(await Bun.file(oldDistPath).bytes())

    const { result, stdout } = await withTTY(true, () => captureStdout(() => publishCommand.run([], {})))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    // Uploaded the existing artifact unchanged.
    expect(call.body).toEqual(oldBytes)
    // Upload address used the artifact's own (older) version.
    expect(stdout).toContain('Published cowsay@0.1.0')
    // The existing dist/ file is still on disk (not rebuilt).
    expect(await Bun.file(oldDistPath).exists()).toBe(true)
  })

  test('TTY, user cancels: no fetch, exits non-zero', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    manifest.version = '0.1.1'
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))
    mockIdentityDriftDecision = 'cancel'
    const spy = createFetchSpy()
    globalThis.fetch = spy.fetch

    const { result, stderr } = await withTTY(true, () => captureStderr(() => publishCommand.run([], {})))

    expect(result).toBe(1)
    expect(spy.calls).toHaveLength(0)
    expect(stderr).toContain('cancelled')
  })

  test('non-TTY: warns and uploads existing artifact, no prompt', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    manifest.version = '0.1.1'
    writeFileSync(join(projectRoot, 'facet.json'), JSON.stringify(manifest, null, 2))
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch
    const oldDistPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.0')
    const oldBytes = new Uint8Array(await Bun.file(oldDistPath).bytes())

    const { result, stderr } = await withTTY(false, () => captureStderr(() => publishCommand.run([], {})))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    // The non-TTY warning mentions the identity-drift summary.
    expect(stderr).toContain('cowsay@0.1.0')
    expect(stderr).toContain('cowsay@0.1.1')
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    expect(call.body).toEqual(oldBytes)
  })
})

describe('publishCommand — artifact verification failure', () => {
  test('garbage on disk where dist/*.facet should be: fails non-zero, no fetch', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    // Overwrite the built artifact with garbage so verification fails.
    const distPath = buildArtifactPath(projectRoot, 'cowsay', '0.1.0')
    writeFileSync(distPath, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]))
    const spy = createFetchSpy()
    globalThis.fetch = spy.fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))

    expect(result).toBe(1)
    expect(spy.calls).toHaveLength(0)
    expect(stderr.toLowerCase()).toMatch(/(verification|invalid|archive)/)
  })
})

describe('publishCommand — embedded identity', () => {
  test('successful publish reports the artifact identity on stdout', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([], {}))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    expect(call.url).toBe('https://api.test/v0/facets/cowsay/versions')
    // The success line is composed from the verified embedded
    // facetManifest's name and version. If a future change read these
    // off the source manifest instead, this assertion would still pass
    // under the natural flow (source == embedded here) — but the test
    // documents the codepath the invariant lives on.
    expect(stdout).toContain('Published cowsay@0.1.0')
  })
})

describe('publishCommand — registry interaction (preserved scenarios)', () => {
  test('202 queued for review: treated as success, renders queue guidance, returns 0', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const spy = createFetchSpy(
      () =>
        new Response(
          JSON.stringify({
            status: 'QUEUED_FOR_REVIEW',
            reason: 'reserved',
            fix: 'an admin will review your submission shortly',
            docsUrl: 'https://agentfacets.io/queue',
          }),
          { status: 202 },
        ),
    )
    globalThis.fetch = spy.fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([], {}))

    expect(result).toBe(0)
    expect(stdout).toContain('submitted for review')
    expect(stdout).toContain('an admin will review your submission shortly')
  })

  test('namespaced facet: URL-encodes the slash', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'acme/cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'acme/cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch

    await captureStdout(() => publishCommand.run([], {}))

    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    expect(call.url).toBe('https://api.test/v0/facets/acme%2Fcowsay/versions')
  })

  test('413 (tarball too large): renders the registry error verbatim', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const spy = createFetchSpy(
      () =>
        new Response(
          JSON.stringify({
            error: 'tarball exceeds the 5 MB size limit',
            code: 'E_TARBALL_TOO_LARGE',
            fix: 'reduce the facet contents below 5 MB or split into multiple facets',
            docsUrl: 'https://agentfacets.io/errors/E_TARBALL_TOO_LARGE',
          }),
          { status: 413 },
        ),
    )
    globalThis.fetch = spy.fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))

    expect(result).toBe(1)
    expect(stderr).toContain('tarball exceeds the 5 MB size limit')
    expect(stderr).toContain('reduce the facet contents below 5 MB')
  })

  test('409 E_VERSION_EXISTS: renders the registry error verbatim, no retry, no mutation', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const spy = createFetchSpy(
      () =>
        new Response(
          JSON.stringify({
            error: 'version 0.1.0 already exists',
            code: 'E_VERSION_EXISTS',
            fix: 'bump the version in facet.json and publish again',
            docsUrl: 'https://agentfacets.io/errors/E_VERSION_EXISTS',
          }),
          { status: 409 },
        ),
    )
    globalThis.fetch = spy.fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))

    expect(result).toBe(1)
    expect(spy.calls).toHaveLength(1)
    expect(stderr).toContain('version 0.1.0 already exists')
    expect(stderr).toContain('bump the version in facet.json and publish again')
    // facet.json must be untouched
    const v = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(v.version).toBe('0.1.0')
  })

  test('network failure: surfaces clean error and does not mutate facet.json', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))

    expect(result).toBe(1)
    expect(stderr).toContain('could not reach the registry')
    const v = JSON.parse(readFileSync(join(projectRoot, 'facet.json'), 'utf8')) as { version: string }
    expect(v.version).toBe('0.1.0')
  })
})

describe('publishCommand — pre-flight failures (preserved scenarios)', () => {
  test('no credential: fails before any HTTP call', async () => {
    await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    delete process.env.FACET_TOKEN
    const spy = createFetchSpy()
    globalThis.fetch = spy.fetch

    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))

    expect(result).toBe(1)
    expect(spy.calls).toHaveLength(0)
    expect(stderr).toContain('not signed in')
    expect(stderr).toContain('facet login')
  })

  test('no facet.json in the target directory: clean error', async () => {
    // projectRoot is an empty temp dir (no manifest written).
    const { result, stderr } = await captureStderr(() => publishCommand.run([], {}))
    expect(result).toBe(1)
    expect(stderr.toLowerCase()).toContain('facet.json')
  })

  test('a directory argument targets that directory for publish', async () => {
    const sub = join(projectRoot, 'nested')
    mkdirSync(sub, { recursive: true })
    await buildFacetFixture(sub, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n' },
    })
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch

    const { result, stdout } = await captureStdout(() => publishCommand.run([sub], {}))

    expect(result).toBe(0)
    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    expect(call.url).toBe('https://api.test/v0/facets/cowsay/versions')
    expect(stdout).toContain('Published cowsay@0.1.0')
  })

  test('a non-existent directory argument errors cleanly', async () => {
    const { result, stderr } = await captureStderr(() => publishCommand.run(['does-not-exist'], {}))
    expect(result).toBe(1)
    expect(stderr.toLowerCase()).toContain('directory does not exist')
  })
})

describe('publishCommand — build/publish parity', () => {
  test('upload bytes are byte-identical to the on-disk dist/*.facet', async () => {
    const { distPath } = await buildFacetFixture(projectRoot, {
      name: 'cowsay',
      version: '0.1.0',
      commands: { cowsay: '# cowsay\n\nrender an ascii cow' },
      skills: { review: '# Review\n\nReview the diff.' },
    })
    const onDiskBytes = new Uint8Array(await Bun.file(distPath).bytes())
    const spy = createFetchSpy(
      () =>
        new Response(JSON.stringify({ contentHash: 'sha256:x', name: 'cowsay', version: '0.1.0' }), {
          status: 201,
        }),
    )
    globalThis.fetch = spy.fetch

    await captureStdout(() => publishCommand.run([], {}))

    expect(spy.calls).toHaveLength(1)
    const call = spy.calls[0]
    if (call === undefined) expect.unreachable()
    // Byte-identical: publish uploaded what build produced, unchanged.
    expect(call.body).toEqual(onDiskBytes)
    // Structurally: the parsed build manifests match across both readings.
    const diskParsed = parseFacetArchive(onDiskBytes)
    const uploadParsed = parseFacetArchive(call.body)
    if (!diskParsed.ok || !uploadParsed.ok) expect.unreachable()
    expect(uploadParsed.data.buildManifest).toEqual(diskParsed.data.buildManifest)
  })
})
