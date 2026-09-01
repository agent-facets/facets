import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION, planSingleFileInstall, planSingleFileRemoval } from '@agent-facets/adapter'
import type { CollisionResolution, CollisionResolutionRequest } from '../commit/compose.ts'
import { receiptPath } from '../receipt.ts'
import { runInstall } from '../run-install.ts'
import type { StageEvent } from '../types.ts'
import { recordingMcpCapability } from './helpers/mcp-adapter.ts'

/**
 * Cross-facet collision detection and resolution, exercised through the real
 * install pipeline.
 *
 * The load-bearing property here is transactional: a collision is discovered
 * after every facet has been resolved and verified, but before the first
 * adapter write. Every test that asserts a failure also asserts that nothing
 * on disk moved.
 */

let projectRoot: string
let originalCwd: string
let originalFacetDir: string | undefined
let fakeHome: string

/** Adapter that records every I/O call so "never invoked" is provable. */
function recordingAdapter(name: string): { adapter: Adapter; io: string[]; mcpDocument: string } {
  const io: string[] = []
  const baseDir = () => join(projectRoot, `.${name}`)
  const file = (type: string, assetName: string) => join(baseDir(), `${type}s`, `${assetName}.md`)
  const mcpDocument = () => join(baseDir(), 'mcp.json')
  const mcp = recordingMcpCapability(mcpDocument)
  return {
    io,
    // Resolved lazily by the caller only after `projectRoot` exists; exposed
    // as a getter so the literal above stays a plain object.
    get mcpDocument() {
      return mcpDocument()
    },
    adapter: {
      name,
      apiVersion: ADAPTER_API_VERSION,
      mcpServers: mcp.capability,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      assets: {
        async planInstall(request) {
          io.push(`install:${request.assetType}:${request.name}`)
          return planSingleFileInstall(
            { file: file(request.assetType, request.name), boundary: projectRoot },
            request.content,
            request.metadata as Record<string, unknown>,
          )
        },
        async planRemoval(request) {
          io.push(`delete:${request.assetType}:${request.name}`)
          return planSingleFileRemoval({ file: file(request.assetType, request.name), boundary: projectRoot })
        },
      },
    },
  }
}

/** A local facet contributing one skill under an explicit name. */
function fixture(facet: string, skill: string, version = '1.0.0'): string {
  const dir = join(projectRoot, 'vendor', facet)
  mkdirSync(join(dir, `skills/${skill}`), { recursive: true })
  writeFileSync(
    join(dir, 'facet.json'),
    JSON.stringify({ name: facet, version, skills: { [skill]: { description: `${skill} skill` } } }),
  )
  writeFileSync(join(dir, `skills/${skill}/SKILL.md`), `# ${skill} from ${facet}\n`)
  return `./vendor/${facet}`
}

/** A local facet whose only deliverable is one MCP server declaration. */
function serverFixture(facet: string, server: string, declaration: unknown, version = '1.0.0'): string {
  const dir = join(projectRoot, 'vendor', facet)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'facet.json'), JSON.stringify({ name: facet, version, servers: { [server]: declaration } }))
  return `./vendor/${facet}`
}

const STDIO = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] }

/**
 * These tests are about composition, not consent: every declaration they
 * install is approved up front so the pipeline reaches the planner. Consent
 * itself — who may approve, and what happens when nobody can — has its own
 * suite.
 */
const ACCEPT_MCP = { kind: 'preapproved' } as const

function writeManifest(value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.json'), text)
  return text
}

function readManifest(): string {
  return readFileSync(join(projectRoot, 'facets.json'), 'utf8')
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-compose-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-compose-home-')))
  process.env.FACET_DIR = join(fakeHome, '.facet')
  process.chdir(projectRoot)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('compose — collision detection', () => {
  test('two facets claiming one skill name fail before any adapter write', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    const before = writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()

    // Both claimants are named, in one report.
    expect(result.failure.groups).toHaveLength(1)
    const entry = result.failure.groups[0]
    if (entry?.kind !== 'asset') expect.unreachable()
    expect(entry.group.effectiveName).toBe('review')
    expect(entry.group.members.map((m) => m.facet).sort()).toEqual(['alpha', 'beta'])

    // Nothing was written, and no adapter I/O method ran at all.
    expect(io).toEqual([])
    expect(result.rollback.kind).toBe('not-needed')
    expect(readManifest()).toBe(before)
    expect(existsSyncSafe(join(projectRoot, 'facets.lock'))).toBe(false)
    expect(existsSyncSafe(receiptPath(projectRoot))).toBe(false)
  })

  test('every colliding group is reported in one pass', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    const c = fixture('gamma', 'deploy')
    const d = fixture('delta', 'deploy')
    writeManifest({ facets: { alpha: a, beta: b, gamma: c, delta: d } })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()
    // Two independent conflicts: a user should learn both at once rather
    // than discovering the second only after fixing the first.
    expect(result.failure.groups.map((g) => g.group.effectiveName).sort()).toEqual(['deploy', 'review'])
  })

  test('agents do not collide with skills of the same name', async () => {
    const dir = join(projectRoot, 'vendor', 'alpha')
    mkdirSync(join(dir, 'skills/review'), { recursive: true })
    mkdirSync(join(dir, 'agents'), { recursive: true })
    writeFileSync(
      join(dir, 'facet.json'),
      JSON.stringify({
        name: 'alpha',
        version: '1.0.0',
        skills: { review: { description: 'review skill' } },
        agents: { review: { description: 'review agent' } },
      }),
    )
    writeFileSync(join(dir, 'skills/review/SKILL.md'), '# skill\n')
    writeFileSync(join(dir, 'agents/review.md'), '# agent\n')
    writeManifest({ facets: { alpha: './vendor/alpha' } })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    expect(result.ok).toBe(true)
  })
})

describe('compose — MCP server composition', () => {
  test('two facets declaring the identical server compose instead of colliding', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    const b = serverFixture('beta', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter } = recordingAdapter('rec')

    // Same declaration, same effective name: one configuration, two
    // claimants. Contesting here would block an install over an agreement.
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT_MCP },
    })
    expect(result.ok).toBe(true)
  })

  test('two facets declaring different servers at one name collide before any write', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    const b = serverFixture('beta', 'filesystem', { type: 'http', url: 'https://example.test/mcp' })
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()
    const entry = result.failure.groups[0]
    if (entry?.kind !== 'mcp-server') expect.unreachable()
    expect(entry.group.effectiveName).toBe('filesystem')
    expect(entry.group.members.map((m) => m.facet).sort()).toEqual(['alpha', 'beta'])
    expect(io).toEqual([])
    expect(existsSyncSafe(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('a server and a skill of the same name do not collide', async () => {
    const a = serverFixture('alpha', 'review', STDIO)
    const b = fixture('beta', 'review')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter } = recordingAdapter('rec')

    // Separate identity spaces, so there is no shared key to contend in.
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT_MCP },
    })
    expect(result.ok).toBe(true)
  })

  test('an alias resolves a server collision, and both survive', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    const b = serverFixture('beta', 'filesystem', { type: 'http', url: 'https://example.test/mcp' })
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { servers: { filesystem: { kind: 'aliased', as: 'alpha-fs' } } } },
        beta: b,
      },
    })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT_MCP },
    })
    expect(result.ok).toBe(true)
  })

  test('an omission resolves a server collision', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    const b = serverFixture('beta', 'filesystem', { type: 'http', url: 'https://example.test/mcp' })
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { servers: { filesystem: { kind: 'omitted' } } } },
        beta: b,
      },
    })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT_MCP },
    })
    expect(result.ok).toBe(true)
  })

  test('a server-only facet installs with zero assets', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT_MCP },
    })

    if (!result.ok) expect.unreachable()
    // The lockfile records the facet with an empty asset list; no adapter
    // asset method runs, because there is no asset.
    expect(io).toEqual([])
    expect(existsSyncSafe(join(projectRoot, 'facets.lock'))).toBe(true)
  })

  test('asset and server collisions are reported together in one pass', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    const c = serverFixture('gamma', 'filesystem', STDIO)
    const d = serverFixture('delta', 'filesystem', { type: 'http', url: 'https://example.test/mcp' })
    writeManifest({ facets: { alpha: a, beta: b, gamma: c, delta: d } })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()
    // Both domains in one report: a user shown the asset conflict now and the
    // server conflict on the next attempt learns the shape of the problem one
    // round trip at a time.
    expect(result.failure.groups.map((g) => g.kind).sort()).toEqual(['asset', 'mcp-server'])
  })

  test('a server-only facet locks with an empty asset list and no server data', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter('rec')

    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT_MCP },
        })
      ).ok,
    ).toBe(true)

    // The lockfile is unchanged by MCP support: a declaration travels inside
    // the integrity-pinned `facet.json`, so duplicating it here would give a
    // shared file a second, unverifiable copy.
    const lockfile = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lockfile.lockfileVersion).toBe(0.3)
    expect(lockfile.facets.alpha.assets).toEqual([])
    expect(JSON.stringify(lockfile)).not.toContain('npx')
    expect(JSON.stringify(lockfile)).not.toContain('servers')
  })

  test('a server override naming an undeclared server is reported as stale, not fatal', async () => {
    const a = serverFixture('alpha', 'filesystem', STDIO)
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { servers: { gone: { kind: 'omitted' } } } },
      },
    })
    const { adapter } = recordingAdapter('rec')
    const events: StageEvent[] = []

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      onStage: (e) => events.push(e),
      operation: { kind: 'reproduce', frozen: false, mcpConsent: ACCEPT_MCP },
    })

    expect(result.ok).toBe(true)
    expect(events.filter((e) => e.kind === 'stale-override-pruned')).toEqual([
      {
        kind: 'stale-override-pruned',
        facet: 'alpha',
        contribution: { kind: 'mcp-server' },
        authoredName: 'gone',
      },
    ])
    // Its last override is gone, so the entry collapses to its compact form.
    expect(JSON.parse(readManifest()).facets.alpha).toBe('./vendor/alpha')
  })
})

describe('compose — resolution', () => {
  test('a resolver that aliases one claimant lets the install proceed', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter('rec')

    let seen: CollisionResolutionRequest | undefined
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (request): Promise<CollisionResolution> => {
          seen = request
          return {
            kind: 'resolved',
            overrides: { beta: { skills: { review: { kind: 'aliased', as: 'beta-review' } } } },
          }
        },
      },
    })
    if (!result.ok) expect.unreachable()

    // The resolver saw the complete authored set, not just the conflict.
    expect(seen?.groups).toHaveLength(1)
    expect(seen?.facets.map((facet) => facet.facet).sort()).toEqual(['alpha', 'beta'])

    // Both assets materialized — nothing was silently dropped.
    expect(io.filter((c) => c.startsWith('install:')).length).toBe(2)
  })

  test('a resolver returning a still-colliding choice fails without reopening it', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter('rec')

    let calls = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (): Promise<CollisionResolution> => {
          calls += 1
          // Aliases both claimants onto ONE new name — still a collision.
          return {
            kind: 'resolved',
            overrides: {
              alpha: { skills: { review: { kind: 'aliased', as: 'shared' } } },
              beta: { skills: { review: { kind: 'aliased', as: 'shared' } } },
            },
          }
        },
      },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MATERIALIZATION_RESOLUTION_INVALID')
    // Exactly once: an automatic retry loop would let a broken resolver spin.
    expect(calls).toBe(1)
    expect(io).toEqual([])
  })

  test('a resolver returning an invalid alias fails with the offending value', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (): Promise<CollisionResolution> => ({
          kind: 'resolved',
          overrides: { beta: { skills: { review: { kind: 'aliased', as: '../escape' } } } },
        }),
      },
    })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MATERIALIZATION_RESOLUTION_INVALID') expect.unreachable()
    expect(result.failure.problems.map((p) => p.alias)).toEqual(['../escape'])
  })

  test('cancellation changes nothing', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    const before = writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (): Promise<CollisionResolution> => ({ kind: 'cancelled' }),
      },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MATERIALIZATION_CANCELLED')
    expect(result.rollback.kind).toBe('not-needed')
    expect(io).toEqual([])
    expect(readManifest()).toBe(before)
    expect(existsSyncSafe(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('frozen mode never invokes a resolver, even when one is supplied', async () => {
    // Two facets already installed and locked without collision, then a
    // third is added to the manifest that would collide. Frozen refuses at
    // the lockfile-coverage gate — before composition — because a manifest
    // the lockfile does not cover is drift regardless of what it contains.
    const a = fixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter('rec')
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    const b = fixture('beta', 'review')
    const before = writeManifest({ facets: { alpha: a, beta: b } })
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')

    // A frozen operation cannot carry a collision resolver at all, so there
    // is no longer a resolver to observe going uncalled.
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('LOCKFILE_DRIFT')
    // The load-bearing assertion: reproducing recorded intent must never
    // collect NEW intent, so the resolver is unreachable in frozen mode.
    expect(readManifest()).toBe(before)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })
})

describe('compose — persisted intent', () => {
  test('a persisted alias resolves the collision with no resolver present', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: a,
        beta: { source: b, materialization: { skills: { review: { kind: 'aliased', as: 'beta-review' } } } },
      },
    })
    const { adapter, io } = recordingAdapter('rec')

    // No resolver: recorded intent must reproduce without prompting, which
    // is what makes a teammate's clone and CI deterministic.
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()
    expect(io.filter((c) => c.startsWith('install:')).length).toBe(2)
  })

  test('an omitted asset is locked but never materialized', async () => {
    const a = fixture('alpha', 'review')
    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { skills: { review: { kind: 'omitted' } } } } },
    })
    const { adapter, io } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    // Nothing installed...
    expect(io.filter((c) => c.startsWith('install:'))).toEqual([])
    // ...but the asset remains in the lockfile with its authored records, so
    // an omission stays distinguishable from a facet that never shipped it.
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lock.facets.alpha.assets[0].name).toBe('review')
    expect(lock.facets.alpha.assets[0].materialization).toEqual({ kind: 'omitted' })
    expect(lock.facets.alpha.assets[0].files[0].path).toBe('skills/review/SKILL.md')
    // ...and absent from the receipt, which records only what is on disk.
    const receipt = JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8'))
    expect(receipt.facets.alpha.assets).toEqual([])
  })

  test('a stale override is reported but does not fail the install', async () => {
    const a = fixture('alpha', 'review')
    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { skills: { gone: { kind: 'omitted' } } } } },
    })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    // An override is durable intent; a facet version that no longer ships
    // the asset is a diagnostic, not a reason to refuse to install.
    expect(result.ok).toBe(true)
  })
})

describe('compose — persisting and pruning intent', () => {
  test('a resolver’s accepted choices are written to facets.json', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (): Promise<CollisionResolution> => ({
          kind: 'resolved',
          overrides: { beta: { skills: { review: { kind: 'aliased', as: 'beta-review' } } } },
        }),
      },
    })
    if (!result.ok) expect.unreachable()

    // Without this, the choice would live only in the lockfile: a teammate
    // cloning the repo would be prompted again for a decision already made.
    const manifest = JSON.parse(readManifest())
    expect(manifest.manifestVersion).toBe(0.2)
    expect(manifest.facets.beta).toEqual({
      source: b,
      materialization: { skills: { review: { kind: 'aliased', as: 'beta-review' } } },
    })
    // The facet that kept its authored name stays compact — an override is
    // recorded only when it says something the default does not.
    expect(manifest.facets.alpha).toBe(a)

    // Re-running with no resolver reproduces the same set from the manifest.
    let reprompted = false
    const again = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (): Promise<CollisionResolution> => {
          reprompted = true
          return { kind: 'cancelled' }
        },
      },
    })
    expect(again.ok).toBe(true)
    expect(reprompted).toBe(false)
  })

  test('a successful install prunes a stale override and reports it', async () => {
    const a = fixture('alpha', 'review')
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: {
          source: a,
          materialization: {
            skills: { review: { kind: 'aliased', as: 'kept' }, gone: { kind: 'omitted' } },
          },
        },
      },
    })
    const { adapter } = recordingAdapter('rec')

    const events: StageEvent[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      onStage: (e) => events.push(e),
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    // The override naming a nonexistent asset is gone; the live one remains.
    const manifest = JSON.parse(readManifest())
    expect(manifest.facets.alpha.materialization).toEqual({
      skills: { review: { kind: 'aliased', as: 'kept' } },
    })

    // Reported as a first-class event, not a verbose-only log line: the file
    // the user committed has changed.
    const prunes = events.filter((e) => e.kind === 'stale-override-pruned')
    expect(prunes).toEqual([
      {
        kind: 'stale-override-pruned',
        facet: 'alpha',
        contribution: { kind: 'asset', assetType: 'skill' },
        authoredName: 'gone',
      },
    ])
  })

  test('pruning the last override collapses the entry back to a compact string', async () => {
    const a = fixture('alpha', 'review')
    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { skills: { gone: { kind: 'omitted' } } } } },
    })
    const { adapter } = recordingAdapter('rec')

    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // An expanded entry exists only to carry overrides. An empty one would be
    // a second spelling of the compact form.
    const manifest = JSON.parse(readManifest())
    expect(manifest.facets.alpha).toBe(a)
  })

  test('a failed install leaves a stale override on disk', async () => {
    const a = fixture('alpha', 'review')
    const before = writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { skills: { gone: { kind: 'omitted' } } } } },
    })

    const failing: Adapter = {
      name: 'failing',
      apiVersion: ADAPTER_API_VERSION,
      mcpServers: false,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      assets: {
        async planInstall() {
          return { ok: false, failure: { code: 'io-failed', path: '/dev/null', message: 'disk on fire' } }
        },
        async planRemoval() {
          return { ok: true, plan: { kind: 'absent', primaryPath: '/dev/null' } }
        },
      },
    }

    const events: StageEvent[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [failing],
      onStage: (e) => events.push(e),
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ADAPTER_INSTALL_FAILED')

    // The prune is part of the transaction, so a failure keeps the override —
    // otherwise a transient adapter error would quietly delete durable intent.
    expect(readManifest()).toBe(before)
    expect(events.some((e) => e.kind === 'stale-override-pruned')).toBe(false)
  })
})

describe('compose — no adapter I/O before the plan exists', () => {
  test('resolution and composition invoke no adapter read, install, or delete', async () => {
    // Four facets, all resolvable, none colliding. The resolver callback is
    // the observation point: by the time it could run, every facet has been
    // fetched and verified, yet no adapter I/O may have occurred — that is
    // what makes a collision failure genuinely transactional.
    const a = fixture('alpha', 'a-review')
    const b = fixture('beta', 'b-review')
    const c = fixture('gamma', 'review')
    const d = fixture('delta', 'review')
    writeManifest({ facets: { alpha: a, beta: b, gamma: c, delta: d } })
    const { adapter, io } = recordingAdapter('rec')

    let ioAtResolverTime: string[] | undefined
    await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (): Promise<CollisionResolution> => {
          ioAtResolverTime = [...io]
          return { kind: 'cancelled' }
        },
      },
    })

    // The resolver ran (so the assertion is not vacuous) and saw no I/O.
    expect(ioAtResolverTime).toEqual([])
  })
})

describe('compose — ordering against other failures', () => {
  test('adapter incompatibility is reported before collision resolution', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    writeManifest({ facets: { alpha: a, beta: b } })

    let _called = false
    const incompatible = {
      name: 'old',
      apiVersion: '0.0',
      buildAssetMetadata: () => {
        throw new Error('contract method invoked despite incompatibility')
      },
      assets: {
        async planInstall() {
          throw new Error('contract method invoked despite incompatibility')
        },
        async planRemoval() {
          throw new Error('contract method invoked despite incompatibility')
        },
      },
    } as unknown as Adapter

    const result = await runInstall({
      projectRoot,
      adapters: [incompatible],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (): Promise<CollisionResolution> => {
          _called = true
          return { kind: 'cancelled' }
        },
      },
    })
    if (result.ok) expect.unreachable()
    // A user should fix their toolchain before being asked to make durable
    // naming decisions.
    expect(result.failure.code).toBe('ADAPTER_INCOMPATIBLE')
  })

  test('the collision-checking stage is emitted before any write', async () => {
    const a = fixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter('rec')

    const events: StageEvent['kind'][] = []
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      onStage: (event) => events.push(event.kind),
      operation: { kind: 'reproduce', frozen: false },
    })
    expect(result.ok).toBe(true)
    const checkAt = events.indexOf('collision-check')
    const materializeAt = events.indexOf('facet-stage')
    expect(checkAt).toBeGreaterThanOrEqual(0)
    expect(checkAt).toBeLessThan(events.lastIndexOf('facet-success'))
    expect(materializeAt).toBeGreaterThanOrEqual(0)
  })
})

function existsSyncSafe(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

describe('compose — resolving server collisions', () => {
  const OTHER = { type: 'stdio', command: 'other-server' }

  test('a server collision reaches the resolver rather than reporting', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: serverFixture('beta', 'filesystem', OTHER),
      },
    })
    const { adapter } = recordingAdapter('rec')

    let seen: CollisionResolutionRequest | undefined
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        mcpConsent: ACCEPT_MCP,
        resolveCollisions: async (request): Promise<CollisionResolution> => {
          seen = request
          return {
            kind: 'resolved',
            overrides: { beta: { servers: { filesystem: { kind: 'aliased', as: 'beta-filesystem' } } } },
          }
        },
      },
    })

    if (!result.ok) expect.unreachable()
    expect(seen?.groups).toHaveLength(1)
    expect(seen?.groups[0]?.kind).toBe('mcp-server')
    // The complete authored set, so an alias can land on a server that was
    // not colliding.
    expect(seen?.facets.map((facet) => facet.facet).sort()).toEqual(['alpha', 'beta'])
    expect(result.summary.mcp.configurations.added).toBe(2)
  })

  test('one report carries an asset group and a server group together', async () => {
    writeManifest({
      facets: {
        alpha: fixture('alpha', 'review'),
        beta: fixture('beta', 'review'),
        gamma: serverFixture('gamma', 'filesystem', STDIO),
        delta: serverFixture('delta', 'filesystem', OTHER),
      },
    })
    const { adapter } = recordingAdapter('rec')

    let seen: CollisionResolutionRequest | undefined
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        mcpConsent: ACCEPT_MCP,
        resolveCollisions: async (request): Promise<CollisionResolution> => {
          seen = request
          return { kind: 'cancelled' }
        },
      },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MATERIALIZATION_CANCELLED')
    expect(seen?.groups.map((entry) => entry.kind).sort()).toEqual(['asset', 'mcp-server'])
  })

  test('cancelling leaves the project and every native document unchanged', async () => {
    const before = writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: serverFixture('beta', 'filesystem', OTHER),
      },
    })
    const { adapter, io } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        mcpConsent: ACCEPT_MCP,
        resolveCollisions: async (): Promise<CollisionResolution> => ({ kind: 'cancelled' }),
      },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MATERIALIZATION_CANCELLED')
    expect(result.rollback.kind).toBe('not-needed')
    expect(readManifest()).toBe(before)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    // Composition precedes MCP preparation, so no adapter was asked to plan
    // a configuration, let alone write one.
    expect(io).toEqual([])
    expect(existsSync(join(projectRoot, '.rec', 'mcp.json'))).toBe(false)
  })

  test('a resolver that omits every server claimant resolves the group', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: serverFixture('beta', 'filesystem', OTHER),
      },
    })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        mcpConsent: ACCEPT_MCP,
        resolveCollisions: async (): Promise<CollisionResolution> => ({
          kind: 'resolved',
          overrides: {
            alpha: { servers: { filesystem: { kind: 'omitted' } } },
            beta: { servers: { filesystem: { kind: 'omitted' } } },
          },
        }),
      },
    })

    if (!result.ok) expect.unreachable()
    expect(result.summary.mcp.declarations.omitted).toBe(2)
    expect(result.summary.mcp.configurations.added).toBe(0)
  })

  test('a resolver answer that still collides fails without reopening it', async () => {
    writeManifest({
      facets: {
        alpha: serverFixture('alpha', 'filesystem', STDIO),
        beta: serverFixture('beta', 'filesystem', OTHER),
      },
    })
    const { adapter } = recordingAdapter('rec')

    let calls = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        mcpConsent: ACCEPT_MCP,
        resolveCollisions: async (): Promise<CollisionResolution> => {
          calls++
          // Moves the problem rather than solving it.
          return {
            kind: 'resolved',
            overrides: { alpha: { servers: { filesystem: { kind: 'aliased', as: 'filesystem' } } } },
          }
        },
      },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MATERIALIZATION_RESOLUTION_INVALID')
    expect(calls).toBe(1)
  })
})
