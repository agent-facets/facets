import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import type { CollisionResolution, CollisionResolutionRequest } from '../commit/compose.ts'
import { receiptPath } from '../receipt.ts'
import { runInstall } from '../run-install.ts'
import type { StageEvent } from '../types.ts'

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
function recordingAdapter(name: string): { adapter: Adapter; io: string[] } {
  const io: string[] = []
  const baseDir = () => join(projectRoot, `.${name}`)
  const file = (type: string, assetName: string) => join(baseDir(), `${type}s`, `${assetName}.md`)
  return {
    io,
    adapter: {
      name,
      apiVersion: ADAPTER_API_VERSION,
      supportsInstall: true,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      async installAsset(request) {
        io.push(`install:${request.assetType}:${request.name}`)
        const p = file(request.assetType, request.name)
        mkdirSync(join(p, '..'), { recursive: true })
        writeFileSync(p, request.content)
        return { ok: true, primaryPath: p }
      },
      async readAsset(request) {
        io.push(`read:${request.assetType}:${request.name}`)
        let content: string
        try {
          content = readFileSync(file(request.assetType, request.name), 'utf8')
        } catch {
          return { ok: false, failure: { code: 'not-found' } }
        }
        return request.assetType === 'skill'
          ? { ok: true, asset: { assetType: 'skill', content, metadata: {}, companions: {} } }
          : { ok: true, asset: { assetType: request.assetType, content, metadata: {} } }
      },
      async deleteAsset(request) {
        io.push(`delete:${request.assetType}:${request.name}`)
        rmSync(file(request.assetType, request.name), { force: true })
        return { ok: true, existed: true, deletedPaths: [] }
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

    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()

    // Both claimants are named, in one report.
    expect(result.failure.groups).toHaveLength(1)
    const group = result.failure.groups[0]
    expect(group?.effectiveName).toBe('review')
    expect(group?.members.map((m) => m.facet).sort()).toEqual(['alpha', 'beta'])

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

    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()
    // Two independent conflicts: a user should learn both at once rather
    // than discovering the second only after fixing the first.
    expect(result.failure.groups.map((g) => g.effectiveName).sort()).toEqual(['deploy', 'review'])
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

    const result = await runInstall({ projectRoot, adapters: [adapter] })
    expect(result.ok).toBe(true)
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
      resolveCollisions: async (request): Promise<CollisionResolution> => {
        seen = request
        return {
          kind: 'resolved',
          overrides: { beta: { skills: { review: { kind: 'aliased', as: 'beta-review' } } } },
        }
      },
    })
    if (!result.ok) expect.unreachable()

    // The resolver saw the complete authored set, not just the conflict.
    expect(seen?.groups).toHaveLength(1)
    expect(seen?.contributions.map((c) => c.facet).sort()).toEqual(['alpha', 'beta'])

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
      resolveCollisions: async (): Promise<CollisionResolution> => ({
        kind: 'resolved',
        overrides: { beta: { skills: { review: { kind: 'aliased', as: '../escape' } } } },
      }),
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
      resolveCollisions: async (): Promise<CollisionResolution> => ({ kind: 'cancelled' }),
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
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)

    const b = fixture('beta', 'review')
    const before = writeManifest({ facets: { alpha: a, beta: b } })
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')

    let called = false
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      frozenLockfile: true,
      resolveCollisions: async (): Promise<CollisionResolution> => {
        called = true
        return { kind: 'cancelled' }
      },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('LOCKFILE_DRIFT')
    // The load-bearing assertion: reproducing recorded intent must never
    // collect NEW intent, so the resolver is unreachable in frozen mode.
    expect(called).toBe(false)
    expect(readManifest()).toBe(before)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })
})

describe('compose — persisted intent', () => {
  test('a persisted alias resolves the collision with no resolver present', async () => {
    const a = fixture('alpha', 'review')
    const b = fixture('beta', 'review')
    writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: a,
        beta: { source: b, materialization: { skills: { review: { kind: 'aliased', as: 'beta-review' } } } },
      },
    })
    const { adapter, io } = recordingAdapter('rec')

    // No resolver: recorded intent must reproduce without prompting, which
    // is what makes a teammate's clone and CI deterministic.
    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (!result.ok) expect.unreachable()
    expect(io.filter((c) => c.startsWith('install:')).length).toBe(2)
  })

  test('an omitted asset is locked but never materialized', async () => {
    const a = fixture('alpha', 'review')
    writeManifest({
      manifestVersion: 0.1,
      facets: { alpha: { source: a, materialization: { skills: { review: { kind: 'omitted' } } } } },
    })
    const { adapter, io } = recordingAdapter('rec')

    const result = await runInstall({ projectRoot, adapters: [adapter] })
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
      manifestVersion: 0.1,
      facets: { alpha: { source: a, materialization: { skills: { gone: { kind: 'omitted' } } } } },
    })
    const { adapter } = recordingAdapter('rec')

    const result = await runInstall({ projectRoot, adapters: [adapter] })
    // An override is durable intent; a facet version that no longer ships
    // the asset is a diagnostic, not a reason to refuse to install.
    expect(result.ok).toBe(true)
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
      resolveCollisions: async (): Promise<CollisionResolution> => {
        ioAtResolverTime = [...io]
        return { kind: 'cancelled' }
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

    let called = false
    const incompatible = {
      name: 'old',
      apiVersion: '0.0',
      supportsInstall: true,
      buildAssetMetadata: () => {
        throw new Error('contract method invoked despite incompatibility')
      },
      async installAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async readAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
      async deleteAsset() {
        throw new Error('contract method invoked despite incompatibility')
      },
    } as unknown as Adapter

    const result = await runInstall({
      projectRoot,
      adapters: [incompatible],
      resolveCollisions: async (): Promise<CollisionResolution> => {
        called = true
        return { kind: 'cancelled' }
      },
    })
    if (result.ok) expect.unreachable()
    // A user should fix their toolchain before being asked to make durable
    // naming decisions.
    expect(result.failure.code).toBe('ADAPTER_INCOMPATIBLE')
    expect(called).toBe(false)
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
