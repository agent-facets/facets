import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import {
  ADAPTER_API_VERSION,
  deleteAssetFile,
  deleteSkillBundle,
  installAssetFile,
  installSkillBundle,
  readAssetFile,
  readSkillBundle,
} from '@agent-facets/adapter'
import type { BuildManifest, Lockfile02 } from '@agent-facets/protocol'
import {
  CURRENT_LOCKFILE_VERSION,
  CurrentLockfileSchema,
  computeContentHash,
  LOCKFILE_VERSION_0_2,
} from '@agent-facets/protocol'
import { type } from 'arktype'
import { type CacheIdentity, cachePath, cachePutVerified, computeDirIntegrity } from '../cache/index.ts'
import { recordingMcpCapability } from '../install/__tests__/helpers/mcp-adapter.ts'
import { loadLockfile } from '../install/lockfile-io.ts'
import { runInstall } from '../install/run-install.ts'
import type { StageEvent } from '../install/types.ts'

let projectRoot: string

/**
 * A single-skill local facet. The skill name defaults to `planning`, but a
 * test installing more than one fixture must give each a distinct skill:
 * two facets claiming one name is a genuine cross-facet collision, and the
 * install now refuses it instead of letting one silently overwrite the
 * other.
 */
function buildLocalFixture(name: string, version = '0.1.0', skill = 'planning'): string {
  const repo = realpathSync(mkdtempSync(join(projectRoot, 'local-fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({
      name,
      version,
      skills: { [skill]: { description: `${skill} skill` } },
    }),
  )
  mkdirSync(join(repo, `skills/${skill}`), { recursive: true })
  writeFileSync(join(repo, `skills/${skill}/SKILL.md`), `# ${skill} ${version}\n`)
  return repo
}

function buildFakeAdapter(name: string): Adapter {
  // Uses the published `@agent-facets/adapter` SDK helpers verbatim so
  // the asset round-trip (assemble → write → read → split) goes through
  // the same code path every real adapter uses. This catches bugs that
  // a hand-rolled persistence wouldn't (see the F2/skip-if-identical
  // round-trip drift).
  const baseDir = join(projectRoot, `.${name}`)
  const path = (type: string, n: string) => ({ file: join(baseDir, `${type}s`, `${n}.md`) })
  const adapter: Adapter = {
    name,
    apiVersion: ADAPTER_API_VERSION,
    supportsInstall: true,
    // A declared capability rather than `false`: a project with an active
    // server declaration now requires one, and an adapter that declines is a
    // different scenario with its own tests.
    mcpServers: recordingMcpCapability(() => join(baseDir, 'mcp.json')).capability,
    buildAssetMetadata: (data) => ({
      ok: true,
      data: (data ?? {}) as Record<string, unknown>,
    }),
    async installAsset(request) {
      const p = path(request.assetType, request.name)
      await installAssetFile(p, request.content, request.metadata as Record<string, unknown> | undefined)
      return { ok: true, primaryPath: p.file }
    },
    async readAsset(request) {
      try {
        const { content, metadata } = await readAssetFile(path(request.assetType, request.name))
        return {
          ok: true,
          asset:
            request.assetType === 'skill'
              ? { assetType: 'skill', content, metadata, companions: {} }
              : { assetType: request.assetType, content, metadata },
        }
      } catch {
        return { ok: false, failure: { code: 'not-found' } }
      }
    },
    async deleteAsset(request) {
      const p = path(request.assetType, request.name)
      await deleteAssetFile(p)
      return { ok: true, existed: true, deletedPaths: [p.file] }
    },
  }
  return adapter
}

/**
 * Fake adapter whose skill layout matches the first-party nested shape
 * (`skills/<name>/SKILL.md`) and passes `pruneBoundary` into the shared
 * delete helper. Used to exercise install-level empty-directory pruning
 * end-to-end through `runInstall`. Agents/commands use the flat layout,
 * mirroring the real Claude Code / OpenCode adapters.
 */
function buildNestedFakeAdapter(name: string): Adapter {
  const baseDir = join(projectRoot, `.${name}`)
  const relFor = (type: string, n: string): string =>
    type === 'skill' ? join('skills', n, 'SKILL.md') : join(`${type}s`, `${n}.md`)
  const path = (type: string, n: string) => ({
    file: join(baseDir, relFor(type, n)),
    pruneBoundary: baseDir,
  })
  return {
    name,
    apiVersion: ADAPTER_API_VERSION,
    supportsInstall: true,
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset(request) {
      const p = path(request.assetType, request.name)
      await installAssetFile(p, request.content, request.metadata as Record<string, unknown> | undefined)
      return { ok: true, primaryPath: p.file }
    },
    async readAsset(request) {
      try {
        const { content, metadata } = await readAssetFile(path(request.assetType, request.name))
        return {
          ok: true,
          asset:
            request.assetType === 'skill'
              ? { assetType: 'skill', content, metadata, companions: {} }
              : { assetType: request.assetType, content, metadata },
        }
      } catch {
        return { ok: false, failure: { code: 'not-found' } }
      }
    },
    async deleteAsset(request) {
      const p = path(request.assetType, request.name)
      await deleteAssetFile(p)
      return { ok: true, existed: true, deletedPaths: [p.file] }
    },
  }
}

/**
 * Adapter that throws on the Nth `installAsset` call. Used to exercise
 * mid-install rollback and partial-write recovery.
 */
function buildBrokenAdapter(name: string, throwOnCall: number): Adapter {
  let calls = 0
  const baseDir = join(projectRoot, `.${name}`)
  return {
    name,
    apiVersion: ADAPTER_API_VERSION,
    supportsInstall: true,
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset(request) {
      calls += 1
      if (calls >= throwOnCall) throw new Error(`${name}: boom on call ${calls}`)
      const file = join(baseDir, `${request.assetType}s`, `${request.name}.md`)
      mkdirSync(join(baseDir, `${request.assetType}s`), { recursive: true })
      writeFileSync(file, request.content)
      return { ok: true, primaryPath: file }
    },
    async readAsset(request) {
      const file = join(baseDir, `${request.assetType}s`, `${request.name}.md`)
      if (!existsSync(file)) {
        return { ok: false, failure: { code: 'not-found' } }
      }
      const content = readFileSync(file, 'utf8')
      return {
        ok: true,
        asset:
          request.assetType === 'skill'
            ? { assetType: 'skill', content, companions: {} }
            : { assetType: request.assetType, content },
      }
    },
    async deleteAsset(request) {
      const file = join(baseDir, `${request.assetType}s`, `${request.name}.md`)
      const existed = existsSync(file)
      if (existed) rmSync(file)
      return { ok: true, existed, deletedPaths: existed ? [file] : [] }
    },
  } as Adapter
}

/**
 * Adapter whose `readAsset` throws a non-ENOENT error. Reproduces F14:
 * a permission failure (or any non-ENOENT) reading the previous content
 * must abort the install before any journal entry is recorded.
 */
function buildBadReadAdapter(name: string): Adapter {
  return {
    name,
    apiVersion: ADAPTER_API_VERSION,
    supportsInstall: true,
    mcpServers: false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    async installAsset() {
      throw new Error('should not be reached: readAsset failed first')
    },
    async readAsset() {
      return {
        ok: false,
        failure: { code: 'io-failed', operation: 'read', message: 'EACCES: permission denied' },
      }
    },
    async deleteAsset() {
      return { ok: true, existed: false, deletedPaths: [] }
    },
  } as Adapter
}

/**
 * Build a fixture facet declaring a custom set of skills. Each skill
 * prompt body is `# <skill-name>` so individual assets can be diffed.
 */
function buildLocalFixtureWithSkills(name: string, skills: string[], version = '0.1.0'): string {
  const repo = realpathSync(mkdtempSync(join(projectRoot, 'multi-skill-')))
  const skillsRecord: Record<string, { description: string }> = {}
  for (const s of skills) {
    skillsRecord[s] = { description: `${s} skill` }
    mkdirSync(join(repo, `skills/${s}`), { recursive: true })
    writeFileSync(join(repo, `skills/${s}/SKILL.md`), `# ${s}\n`)
  }
  writeFileSync(join(repo, 'facet.json'), JSON.stringify({ name, version, skills: skillsRecord }))
  return repo
}

// Single `FACET_DIR` tmpdir for the whole facet tree (cache + locks + adapters
// + bin). Only cache and locks are exercised by these tests; adapters and bin
// are unused. The `cacheDir` alias is preserved for any test that asserts on
// the cache path directly.
let facetDir: string
let cacheDir: string
let originalFacetDir: string | undefined

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'run-install-test-')))
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'run-install-facet-')))
  cacheDir = join(facetDir, 'cache')
  // Tests that seed the cache directly (e.g., via `mkdtempSync(join(cacheDir, ...))`)
  // need the subdirectory to exist. The CLI's cache layer would create it
  // lazily on first put, but seeding fixtures bypasses that path.
  mkdirSync(cacheDir, { recursive: true })
  originalFacetDir = process.env.FACET_DIR
  process.env.FACET_DIR = facetDir
})

afterEach(() => {
  if (originalFacetDir === undefined) {
    delete process.env.FACET_DIR
  } else {
    process.env.FACET_DIR = originalFacetDir
  }
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(facetDir, { recursive: true, force: true })
})

describe('runInstall — facets.json discovery', () => {
  test('FACETS_JSON_NOT_FOUND when missing', async () => {
    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FACETS_JSON_NOT_FOUND')
  })

  test('FACETS_JSON_INVALID when malformed', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{this is not json')
    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FACETS_JSON_INVALID')
  })
})

describe('runInstall — local source success path with events', () => {
  test('installs a single local facet and emits a full event sequence', async () => {
    const local = buildLocalFixture('viper-plans')
    const relPath = `./${local.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    const events: StageEvent[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
      onStage: (e) => events.push(e),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.summary.facets.installed).toBe(1)
    expect(result.lockfile.facets['viper-plans']?.version).toBe('0.1.0')
    expect(events.find((e) => e.kind === 'install-start')).toBeDefined()
    expect(events.find((e) => e.kind === 'facet-success')).toBeDefined()
    expect(events.find((e) => e.kind === 'install-complete')).toBeDefined()
  })
})

describe('runInstall — local source success path', () => {
  test('installs a single local facet', async () => {
    const local = buildLocalFixture('viper-plans')
    const relPath = `./${local.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.summary.facets.installed).toBe(1)
    expect(result.lockfile.facets['viper-plans']?.version).toBe('0.1.0')
  })

  // 9.1/9.2: a fresh normal install records the current (`0.2`) lockfile
  // with per-materialized-file integrity records derived from the verified
  // build, not identity-only assets.
  test('a fresh install writes a 0.2 lockfile with recomputed per-file records', async () => {
    const local = buildLocalFixture('viper-plans')
    const relPath = `./${local.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    const result = await runInstall({ projectRoot, adapters: [buildFakeAdapter('test')] })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    expect(result.lockfile.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)

    // The written lockfile round-trips: reloading it under exact 0.2 dispatch
    // succeeds (an identity-only 0.2 entry would fail the CurrentLockfile
    // schema on reload) and reports the current version.
    const reloaded = loadLockfile(projectRoot)
    if (!reloaded.ok) expect.unreachable()
    expect(reloaded.parsed.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)

    // Validate the written bytes against the current schema and inspect the
    // per-file records off the validated (current) shape.
    const written = CurrentLockfileSchema(JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')))
    if (written instanceof type.errors) expect.unreachable()
    const asset = written.facets['viper-plans']?.assets.find((a) => a.type === 'skill' && a.name === 'planning')
    if (asset === undefined) expect.unreachable()
    expect(asset.files).toEqual([
      { path: 'skills/planning/SKILL.md', integrity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    ])
  })

  // 9.3: pre-materialization reconciliation. A locked per-file hash that no
  // longer matches the freshly-derived plan aborts before any adapter write
  // with a path-specific failure.
  test('a tampered locked per-file hash aborts with RECONCILE_PER_FILE_INTEGRITY', async () => {
    const local = buildLocalFixture('viper-plans')
    const relPath = `./${local.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    // First install writes a valid 0.2 lockfile.
    const first = await runInstall({ projectRoot, adapters: [buildFakeAdapter('test')] })
    if (!first.ok) expect.unreachable()

    // Tamper the locked per-file integrity for the skill's SKILL.md so the
    // freshly-derived plan disagrees on re-install.
    const lockPath = join(projectRoot, 'facets.lock')
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    const wrong = `sha256:${'1'.repeat(64)}`
    lock.facets['viper-plans'].assets[0].files[0].integrity = wrong
    writeFileSync(lockPath, JSON.stringify(lock))

    const second = await runInstall({ projectRoot, adapters: [buildFakeAdapter('test')] })
    if (second.ok) expect.unreachable()
    if (second.failure.code !== 'RECONCILE_PER_FILE_INTEGRITY') expect.unreachable()
    expect(second.failure.facet).toBe('viper-plans')
    expect(second.failure.asset).toBe('skill:planning')
    expect(second.failure.path).toBe('skills/planning/SKILL.md')
    expect(second.failure.expected).toBe(wrong)
    expect(second.failure.actual).toMatch(/^sha256:[a-f0-9]{64}$/)
    // Reconciliation runs during resolve, before the journal is even
    // created, so there is nothing to roll back — not an empty replay.
    expect(second.rollback.kind).toBe('not-needed')
    // The tampered lockfile is left unchanged on disk (no tri-write ran).
    const after = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(after.facets['viper-plans'].assets[0].files[0].integrity).toBe(wrong)
  })

  test('a locked owned-path set that differs from the plan aborts with RECONCILE_OWNED_PATH_SET', async () => {
    const local = buildLocalFixture('viper-plans')
    const relPath = `./${local.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    // First install writes a valid 0.2 lockfile.
    const first = await runInstall({ projectRoot, adapters: [buildFakeAdapter('test')] })
    if (!first.ok) expect.unreachable()

    // Inject an extra owned-file record into the locked skill entry so the
    // locked path set has a path the freshly-derived plan does not own.
    const lockPath = join(projectRoot, 'facets.lock')
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    lock.facets['viper-plans'].assets[0].files.push({
      path: 'skills/planning/references/ghost.md',
      integrity: `sha256:${'2'.repeat(64)}`,
    })
    writeFileSync(lockPath, JSON.stringify(lock))

    const second = await runInstall({ projectRoot, adapters: [buildFakeAdapter('test')] })
    if (second.ok) expect.unreachable()
    if (second.failure.code !== 'RECONCILE_OWNED_PATH_SET') expect.unreachable()
    expect(second.failure.facet).toBe('viper-plans')
    expect(second.failure.asset).toBe('skill:planning')
    // The extra locked path is reported as missing from the plan.
    expect(second.failure.missing).toContain('skills/planning/references/ghost.md')
    expect(second.failure.unexpected).toEqual([])
    // Reconciliation runs during resolve, before the journal is even
    // created, so there is nothing to roll back — not an empty replay.
    expect(second.rollback.kind).toBe('not-needed')
  })
})

describe('runInstall — registry source surfaces REGISTRY_ERROR on resolution failure', () => {
  test('unreachable registry: bare registry name fails with REGISTRY_ERROR / NETWORK_ERROR', async () => {
    // Point at an unresolvable host so the resolver hits a real network
    // failure (no mock) — exercises the failure-translation path end-to-end.
    const originalEnv = process.env.FACET_REGISTRY_URL
    process.env.FACET_REGISTRY_URL = 'http://127.0.0.1:1' // closed port
    try {
      writeFileSync(
        join(projectRoot, 'facets.json'),
        JSON.stringify({ facets: { 'viper-plans': 'viper-plans@1.0.0' } }),
      )

      const result = await runInstall({
        projectRoot,
        adapters: [buildFakeAdapter('test')],
      })
      expect(result.ok).toBe(false)
      if (result.ok) expect.unreachable()
      expect(result.failure.code).toBe('REGISTRY_ERROR')
      if (result.failure.code !== 'REGISTRY_ERROR') expect.unreachable()
      // Either NETWORK_ERROR (refused/dns) or NOT_FOUND if the unlikely
      // event the host is reachable; both signal "registry didn't help".
      expect(['NETWORK_ERROR', 'NOT_FOUND']).toContain(result.failure.error.code)
      expect(result.failure.facet).toBe('viper-plans')
    } finally {
      if (originalEnv === undefined) delete process.env.FACET_REGISTRY_URL
      else process.env.FACET_REGISTRY_URL = originalEnv
    }
  })
})

describe('runInstall — composition is rejected', () => {
  test('facet declaring `facets` array is rejected with COMPOSITION_REJECTED', async () => {
    const fixture = realpathSync(mkdtempSync(join(projectRoot, 'composing-')))
    writeFileSync(
      join(fixture, 'facet.json'),
      JSON.stringify({
        name: 'composing',
        version: '0.1.0',
        facets: ['inner-dep@1.0.0'],
      }),
    )

    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { composing: `./${fixture.split('/').pop()}` } }),
    )

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('COMPOSITION_REJECTED')
  })
})

describe('runInstall — manifest name mismatch', () => {
  test('facet.json name mismatch returns MANIFEST_NAME_MISMATCH', async () => {
    const fixture = buildLocalFixture('actually-named')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'declared-name': `./${fixture.split('/').pop()}` } }),
    )

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('MANIFEST_NAME_MISMATCH')
    if (result.failure.code !== 'MANIFEST_NAME_MISMATCH') expect.unreachable()
    expect(result.failure.manifestName).toBe('actually-named')
  })
})

describe('runInstall — concrete MCP declarations', () => {
  // The warn-and-skip path this block used to cover is gone: a speculative
  // version-string reference is now a validation failure, not a successful
  // install carrying a warning. Materialization of concrete declarations is
  // added later in this change; for now the contract under test is that a
  // valid declaration no longer blocks or degrades an install.
  test('a facet declaring a concrete server installs its assets', async () => {
    const fixture = realpathSync(mkdtempSync(join(projectRoot, 'with-servers-')))
    writeFileSync(
      join(fixture, 'facet.json'),
      JSON.stringify({
        name: 'with-servers',
        version: '0.1.0',
        skills: { planning: { description: 'planning skill' } },
        servers: { 'inline-server': { type: 'stdio', command: 'inline-mcp' } },
      }),
    )
    mkdirSync(join(fixture, 'skills/planning'), { recursive: true })
    writeFileSync(join(fixture, 'skills/planning/SKILL.md'), '# planning\n')

    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'with-servers': `./${fixture.split('/').pop()}` } }),
    )

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
      // A declaration authorizes execution, so an unapproved one now stops
      // the run. This test is about the declaration not *degrading* the
      // install; approval is exercised on its own.
      mcpConsent: { kind: 'preapproved' },
    })
    expect(result.ok).toBe(true)
  })

  test('a speculative version-string reference fails validation', async () => {
    const fixture = realpathSync(mkdtempSync(join(projectRoot, 'legacy-servers-')))
    writeFileSync(
      join(fixture, 'facet.json'),
      JSON.stringify({
        name: 'legacy-servers',
        version: '0.1.0',
        skills: { planning: { description: 'planning skill' } },
        servers: { 'inline-server': '1.0.0' },
      }),
    )
    mkdirSync(join(fixture, 'skills/planning'), { recursive: true })
    writeFileSync(join(fixture, 'skills/planning/SKILL.md'), '# planning\n')

    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'legacy-servers': `./${fixture.split('/').pop()}` } }),
    )

    const result = await runInstall({ projectRoot, adapters: [buildFakeAdapter('test')] })
    expect(result.ok).toBe(false)
  })
})

describe('runInstall — drift removal', () => {
  test('facets in lockfile but not facets.json are removed', async () => {
    const local = buildLocalFixture('keeper')
    const orphan = buildLocalFixture('orphan', '0.1.0', 'orphan-planning')

    // First install: both facets.
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        facets: {
          keeper: `./${local.split('/').pop()}`,
          orphan: `./${orphan.split('/').pop()}`,
        },
      }),
    )
    const first = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(first.ok).toBe(true)

    // Second install: drop orphan from facets.json.
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { keeper: `./${local.split('/').pop()}` } }),
    )
    const events: StageEvent[] = []
    const second = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
      onStage: (e) => events.push(e),
    })
    expect(second.ok).toBe(true)
    if (!second.ok) expect.unreachable()
    expect(second.summary.facets.removed).toBe(1)
    expect(second.lockfile.facets.orphan).toBeUndefined()
    expect(second.lockfile.facets.keeper).toBeDefined()
    expect(events.find((e) => e.kind === 'drift-removal')).toBeDefined()
  })
})

describe('runInstall — lockfile bootstrap and reuse', () => {
  test('first install bootstraps a lockfile from facets.json', async () => {
    const local = buildLocalFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )
    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.lockfile.facets['viper-plans']?.version).toBe('0.1.0')
  })

  test('second install reuses the lockfile and reports unchanged', async () => {
    const local = buildLocalFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )

    const bootstrap = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(bootstrap.ok).toBe(true)

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.lockfile.facets['viper-plans']?.version).toBe('0.1.0')
    // Same content + metadata on disk → skip-if-identical kicks in:
    // the facet reports as unchanged with zero new writes.
    expect(result.summary.facets.unchanged).toBe(1)
    expect(result.summary.textAssets.written).toBe(0)
  })

  test('repaired: deleted asset is re-written and reported as repaired', async () => {
    const local = buildLocalFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )

    const bootstrap = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(bootstrap.ok).toBe(true)

    // Manually delete the materialized skill file from the adapter dir.
    const skillPath = join(projectRoot, '.test/skills/planning.md')
    expect(existsSync(skillPath)).toBe(true)
    rmSync(skillPath)

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.summary.facets.repaired).toBe(1)
    expect(result.summary.facets.unchanged).toBe(0)
    expect(result.summary.textAssets.written).toBe(1)
    expect(existsSync(skillPath)).toBe(true)
  })
})

describe('runInstall — abort signal', () => {
  test('pre-aborted signal returns ABORTED before any work', async () => {
    const local = buildLocalFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )

    const controller = new AbortController()
    controller.abort()

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
      signal: controller.signal,
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ABORTED')
    // The CLI decides what to tell the user about disk state from THIS, not
    // from the failure code: an abort before Apply left nothing behind, one
    // during Apply was rolled back. Asserting only the code let the two
    // become indistinguishable to every reader downstream.
    expect(result.rollback.kind).toBe('not-needed')
  })
})

describe('runInstall — asset-level drift across versions', () => {
  test('asset removed from facet manifest is deleted from adapter on next install', async () => {
    // First install: facet declares two skills.
    const fixture = buildLocalFixtureWithSkills('viper-plans', ['planning', 'extras'])
    const relPath = `./${fixture.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))
    const first = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(first.ok).toBe(true)
    expect(existsSync(join(projectRoot, '.test/skills/planning.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.test/skills/extras.md'))).toBe(true)

    // Modify fixture: drop the `extras` skill.
    rmSync(join(fixture, 'skills/extras'), { recursive: true, force: true })
    writeFileSync(
      join(fixture, 'facet.json'),
      JSON.stringify({
        name: 'viper-plans',
        version: '0.2.0',
        skills: { planning: { description: 'planning skill' } },
      }),
    )

    // Second install: extras must be removed from the adapter.
    const second = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })
    expect(second.ok).toBe(true)
    expect(existsSync(join(projectRoot, '.test/skills/planning.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.test/skills/extras.md'))).toBe(false)
  })
})

describe('runInstall — empty skill directory pruning (nested layout)', () => {
  test('removing a skill deletes its SKILL.md and prunes the now-empty directory', async () => {
    // First install: facet declares two skills, materialized to the nested
    // `skills/<name>/SKILL.md` layout the real first-party adapters use.
    const fixture = buildLocalFixtureWithSkills('viper-plans', ['planning', 'extras'])
    const relPath = `./${fixture.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))
    const first = await runInstall({
      projectRoot,
      adapters: [buildNestedFakeAdapter('nested')],
    })
    expect(first.ok).toBe(true)
    expect(existsSync(join(projectRoot, '.nested/skills/planning/SKILL.md'))).toBe(true)
    expect(existsSync(join(projectRoot, '.nested/skills/extras/SKILL.md'))).toBe(true)

    // Drop the `extras` skill from the fixture.
    rmSync(join(fixture, 'skills/extras'), { recursive: true, force: true })
    writeFileSync(
      join(fixture, 'facet.json'),
      JSON.stringify({
        name: 'viper-plans',
        version: '0.2.0',
        skills: { planning: { description: 'planning skill' } },
      }),
    )

    const second = await runInstall({
      projectRoot,
      adapters: [buildNestedFakeAdapter('nested')],
    })
    expect(second.ok).toBe(true)
    // SKILL.md is gone AND the now-empty skill directory is pruned.
    expect(existsSync(join(projectRoot, '.nested/skills/extras/SKILL.md'))).toBe(false)
    expect(existsSync(join(projectRoot, '.nested/skills/extras'))).toBe(false)
    // The surviving skill is untouched.
    expect(existsSync(join(projectRoot, '.nested/skills/planning/SKILL.md'))).toBe(true)
  })

  test('a skill directory containing an unrelated file is preserved on removal', async () => {
    const fixture = buildLocalFixtureWithSkills('viper-plans', ['planning', 'extras'])
    const relPath = `./${fixture.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))
    const first = await runInstall({
      projectRoot,
      adapters: [buildNestedFakeAdapter('nested')],
    })
    expect(first.ok).toBe(true)

    // A user drops an unrelated file into the extras skill directory.
    const stray = join(projectRoot, '.nested/skills/extras/user-notes.md')
    writeFileSync(stray, 'do not delete me')

    // Drop the `extras` skill from the fixture.
    rmSync(join(fixture, 'skills/extras'), { recursive: true, force: true })
    writeFileSync(
      join(fixture, 'facet.json'),
      JSON.stringify({
        name: 'viper-plans',
        version: '0.2.0',
        skills: { planning: { description: 'planning skill' } },
      }),
    )

    const second = await runInstall({
      projectRoot,
      adapters: [buildNestedFakeAdapter('nested')],
    })
    expect(second.ok).toBe(true)
    // The managed SKILL.md is gone, but the directory survives because of
    // the unrelated file — non-recursive prune refuses to remove it.
    expect(existsSync(join(projectRoot, '.nested/skills/extras/SKILL.md'))).toBe(false)
    expect(existsSync(stray)).toBe(true)
    expect(existsSync(join(projectRoot, '.nested/skills/extras'))).toBe(true)
  })
})

describe('runInstall — rollback on adapter throw', () => {
  test('mid-install adapter throw rolls back successful prior writes and skips lockfile write', async () => {
    const fixture = buildLocalFixtureWithSkills('viper-plans', ['planning', 'other'])
    const relPath = `./${fixture.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    // Adapter that succeeds on the first installAsset call and throws on the second.
    const result = await runInstall({
      projectRoot,
      adapters: [buildBrokenAdapter('broken', 2)],
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ADAPTER_INSTALL_FAILED')

    // Both assets rolled back — neither should be on disk after rollback.
    expect(existsSync(join(projectRoot, '.broken/skills/planning.md'))).toBe(false)
    expect(existsSync(join(projectRoot, '.broken/skills/other.md'))).toBe(false)

    // No lockfile must have been written on failure.
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('multi-adapter: second adapter failure rolls back first adapter writes', async () => {
    const fixture = buildLocalFixtureWithSkills('viper-plans', ['planning'])
    const relPath = `./${fixture.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    // adapter-a writes for real; adapter-b unconditionally throws on installAsset.
    const adapterA = buildFakeAdapter('adapter-a')
    const adapterB = buildBrokenAdapter('adapter-b', 1)

    const result = await runInstall({
      projectRoot,
      adapters: [adapterA, adapterB],
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ADAPTER_INSTALL_FAILED')

    // adapter-a's write must be rolled back.
    expect(existsSync(join(projectRoot, '.adapter-a/skills/planning.md'))).toBe(false)
    // No lockfile.
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })
})

describe('runInstall — lockfile write failure rolls back', () => {
  test('writeLockfile failure rolls back assets and returns LOCKFILE_WRITE_FAILED', async () => {
    const fixture = buildLocalFixture('viper-plans')
    const relPath = `./${fixture.split('/').pop()}`
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'viper-plans': relPath } }))

    // Sabotage the lockfile write by pre-creating `facets.lock.tmp` as
    // a *directory*. The atomic write path is `writeFileSync(tmp)`
    // then `renameSync(tmp, path)`; opening a directory for write
    // fails with EISDIR. We can't sabotage `facets.lock` directly
    // because `loadLockfile` reads it first and would surface a
    // different error before we ever reach the write.
    mkdirSync(join(projectRoot, 'facets.lock.tmp'), { recursive: true })

    const adapter = buildFakeAdapter('test')
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
    })

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('LOCKFILE_WRITE_FAILED')
    if (result.failure.code !== 'LOCKFILE_WRITE_FAILED') expect.unreachable()
    expect(result.failure.path).toBe(join(projectRoot, 'facets.lock'))
    expect(result.failure.cause.length).toBeGreaterThan(0)

    // Rollback succeeded: the asset that was materialized before the
    // lockfile write should be undone. `kind: 'succeeded'` distinguishes
    // a real rollback from `not-needed`.
    expect(result.rollback.kind).toBe('succeeded')
    if (result.rollback.kind === 'succeeded') {
      expect(result.rollback.entriesUndone).toBeGreaterThan(0)
    }
    expect(existsSync(join(projectRoot, '.test/skills/planning.md'))).toBe(false)
  })
})

describe('runInstall — F14: non-ENOENT read error aborts before any journal record', () => {
  test('readAsset throwing EACCES aborts install with no journal entries to roll back', async () => {
    const fixture = buildLocalFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${fixture.split('/').pop()}` } }),
    )

    const result = await runInstall({
      projectRoot,
      adapters: [buildBadReadAdapter('bad-read')],
    })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    // Post-#3-cluster-A: read failures get their own dedicated code so
    // the CLI can render a different message ("we couldn't even read
    // the existing file" vs. "the install write itself failed"). The
    // adapter name is preserved end-to-end (no more `'unknown'` literal).
    expect(result.failure.code).toBe('ADAPTER_READ_FAILED')
    if (result.failure.code === 'ADAPTER_READ_FAILED') {
      expect(result.failure.adapter).toBe('bad-read')
      expect(result.failure.cause).toMatch(/EACCES|simulated/)
    }
    // The read failure happens inside `materialize`, which goes through
    // `rollbackAndFail`. The journal recorded zero entries before the
    // failure (the read error is the F14 guard preventing any write from
    // being attempted), so rollback "succeeds" with `entriesUndone: 0`
    // — a real rollback that had nothing to undo.
    expect(result.rollback.kind).toBe('succeeded')
    if (result.rollback.kind === 'succeeded') {
      expect(result.rollback.entriesUndone).toBe(0)
    }
    // No lockfile.
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })
})

/**
 * Build a fixture facet IN the cache slot directly. Returns the
 * matching lockfile entry that points at it. Bypasses cloning + build
 * pipeline; the resulting cache slot is what `runInstall` would see
 * after a successful prior install of a git source.
 */
function seedCacheSlotForGit(
  facetName: string,
  version: string,
): { entry: Lockfile02['facets'][string]; slotPath: string } {
  const id: CacheIdentity = { kind: 'git', name: facetName, version }
  const slotPath = cachePath(id)

  // Build a real source tree in a staging dir, then cachePutVerified
  // moves it into the slot with a real sidecar.
  const staging = realpathSync(mkdtempSync(join(cacheDir, '.staging-seed-')))
  const facetJson = JSON.stringify({
    name: facetName,
    version,
    skills: { planning: { description: 'planning skill' } },
  })
  const skillBody = `# planning ${version}\n`
  writeFileSync(join(staging, 'facet.json'), facetJson)
  mkdirSync(join(staging, 'skills/planning'), { recursive: true })
  writeFileSync(join(staging, 'skills/planning/SKILL.md'), skillBody)

  // Construct a build manifest with the GENUINE canonical integrity of
  // the staged content. Cache hits are audited on read (D4): the
  // install recomputes per-asset hashes AND the canonical-tar hash and
  // compares them to the sidecar, so a fake top-level integrity would
  // fail the self-audit and evict the slot.
  const computed = computeDirIntegrity(staging, ['facet.json', 'skills/planning/SKILL.md'])
  if (!computed.ok) throw new Error('test bug: staged fixture unreadable')
  const integrity = computed.integrity
  const manifest: BuildManifest = {
    facetVersion: 0.1,
    archive: 'archive.tar.gz',
    integrity,
    assets: {
      'facet.json': computeContentHash(facetJson),
      'skills/planning/SKILL.md': computeContentHash(skillBody),
    },
  }
  const result = cachePutVerified(
    id,
    staging,
    { integrity: manifest.integrity, fileHashes: manifest.assets },
    integrity,
    facetName,
  )
  if (!result.ok) expect.unreachable()

  return {
    entry: {
      source: {
        kind: 'git',
        url: `https://github.com/example/${facetName}.git`,
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      version,
      integrity,
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'planning',
          // The genuine per-file hash: a locked entry whose facet integrity
          // matches the resolved artifact is a reproduction, so per-file
          // reconciliation runs against these records.
          files: [{ path: 'skills/planning/SKILL.md', integrity: computeContentHash(skillBody) }],
        },
      ],
    },
    slotPath,
  }
}

describe('runInstall — git cache hit short-circuits clone', () => {
  test('locked entry with a populated cache slot installs without cloning', async () => {
    const facetName = 'viper-plans'
    const version = '0.1.0'
    const { entry } = seedCacheSlotForGit(facetName, version)

    // The manifest source matches the locked source, so the cache-hit path
    // is eligible. The URL points at an unreachable host — if anything tries
    // to clone, the test will hang/fail. The cache hit must short-circuit
    // before cloning.
    const lockfile: Lockfile02 = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: { [facetName]: entry },
    }
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { [facetName]: `https://github.com/example/${facetName}.git` } }),
    )
    writeFileSync(join(projectRoot, 'facets.lock'), JSON.stringify(lockfile))

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    // The locked entry is sticky: the trusted-cache-hit path skips the build
    // pipeline and inherits locked.* verbatim. Output integrity must equal
    // input integrity exactly.
    expect(result.lockfile.facets[facetName]?.version).toBe(version)
    expect(result.lockfile.facets[facetName]?.integrity).toBe(entry.integrity)
    // The git provenance — url + resolved commit — survives verbatim.
    expect(result.lockfile.facets[facetName]?.source).toEqual({
      kind: 'git',
      url: `https://github.com/example/${facetName}.git`,
      commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })

    // Migration: the seeded lockfile was `0.2`, which records per-file
    // integrity but no disposition. A normal (non-frozen) install migrates it
    // to the current schema, keeping the locked identity and file records
    // untouched. Assets that carry no project override migrate to the
    // `authored` disposition — the only meaning a `0.2` entry could have
    // had.
    expect(result.lockfile.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
    const written = CurrentLockfileSchema(JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')))
    if (written instanceof type.errors) expect.unreachable()
    expect(written.facets[facetName]?.assets).toEqual([
      {
        scope: 'project',
        type: 'skill',
        name: 'planning',
        materialization: { kind: 'authored' },
        files: [{ path: 'skills/planning/SKILL.md', integrity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }],
      },
    ])
  })

  test('returns CACHE_INTEGRITY_MISMATCH when sidecar disagrees with lockfile', async () => {
    const facetName = 'viper-plans'
    const version = '0.1.0'
    const { entry, slotPath } = seedCacheSlotForGit(facetName, version)

    // Forge a lockfile entry with a different integrity than what the
    // cache sidecar recorded. Cache says X, lockfile demands Y.
    const wrongIntegrity = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    const lockfile: Lockfile02 = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: { [facetName]: { ...entry, integrity: wrongIntegrity } },
    }
    // Manifest source matches the locked source so the cache-hit path runs;
    // the sidecar/lockfile integrity disagreement is what must be caught.
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { [facetName]: `https://github.com/example/${facetName}.git` } }),
    )
    writeFileSync(join(projectRoot, 'facets.lock'), JSON.stringify(lockfile))

    const result = await runInstall({
      projectRoot,
      adapters: [buildFakeAdapter('test')],
    })

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('CACHE_INTEGRITY_MISMATCH')
    if (result.failure.code !== 'CACHE_INTEGRITY_MISMATCH') expect.unreachable()
    expect(result.failure.facet).toBe(facetName)
    expect(result.failure.slotPath).toBe(slotPath)
    expect(result.failure.cachedIntegrity).toBe(entry.integrity)
    expect(result.failure.lockedIntegrity).toBe(wrongIntegrity)
  })
})

// 9.6: real skill-bundle materialization — companions install, skip when
// identical, and repair per-file drift. Uses the SDK bundle helpers so the
// companion round-trip goes through the same code every real adapter uses.
describe('runInstall — multi-file skill materialization', () => {
  function buildBundleFixture(name: string, version = '0.1.0'): string {
    const repo = realpathSync(mkdtempSync(join(projectRoot, 'bundle-fixture-')))
    writeFileSync(
      join(repo, 'facet.json'),
      JSON.stringify({
        name,
        version,
        skills: { planning: { description: 'planning skill', files: ['references/api.md', 'assets/logo.bin'] } },
      }),
    )
    mkdirSync(join(repo, 'skills/planning/references'), { recursive: true })
    mkdirSync(join(repo, 'skills/planning/assets'), { recursive: true })
    writeFileSync(join(repo, 'skills/planning/SKILL.md'), `# planning ${version}\n`)
    writeFileSync(join(repo, 'skills/planning/references/api.md'), '# api reference\n')
    // A binary companion — must survive byte-for-byte.
    writeFileSync(join(repo, 'skills/planning/assets/logo.bin'), Buffer.from([0, 1, 2, 253, 254, 255]))
    return repo
  }

  /** Fake adapter that stores skills as bundles via the SDK helpers. */
  function buildBundleAdapter(name: string): Adapter {
    const baseDir = join(projectRoot, `.${name}`)
    const skillPaths = (n: string) => ({
      root: join(baseDir, 'skills', n),
      primaryFile: join(baseDir, 'skills', n, 'SKILL.md'),
      pruneBoundary: baseDir,
    })
    const flatPath = (type: string, n: string) => ({ file: join(baseDir, `${type}s`, `${n}.md`) })
    return {
      name,
      apiVersion: ADAPTER_API_VERSION,
      supportsInstall: true,
      mcpServers: false,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      async installAsset(request) {
        if (request.assetType === 'skill') {
          return installSkillBundle(skillPaths(request.name), {
            content: request.content,
            metadata: request.metadata as Record<string, unknown> | undefined,
            companions: request.companions,
            ownedCompanionPaths: request.ownedCompanionPaths,
          })
        }
        const p = flatPath(request.assetType, request.name)
        await installAssetFile(p, request.content, request.metadata as Record<string, unknown> | undefined)
        return { ok: true, primaryPath: p.file }
      },
      async readAsset(request) {
        if (request.assetType === 'skill') {
          return readSkillBundle(skillPaths(request.name), request.ownedCompanionPaths)
        }
        try {
          const { content, metadata } = await readAssetFile(flatPath(request.assetType, request.name))
          return { ok: true, asset: { assetType: request.assetType, content, metadata } }
        } catch {
          return { ok: false, failure: { code: 'not-found' } }
        }
      },
      async deleteAsset(request) {
        if (request.assetType === 'skill') {
          return deleteSkillBundle(skillPaths(request.name), request.ownedCompanionPaths)
        }
        const p = flatPath(request.assetType, request.name)
        await deleteAssetFile(p)
        return { ok: true, existed: true, deletedPaths: [p.file] }
      },
    }
  }

  test('installs a skill with companions and records their owned paths', async () => {
    const local = buildBundleFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )

    const result = await runInstall({ projectRoot, adapters: [buildBundleAdapter('bundle')] })
    if (!result.ok) expect.unreachable()

    // Both companions materialized, binary preserved byte-for-byte.
    const companionDir = join(projectRoot, '.bundle/skills/planning')
    expect(readFileSync(join(companionDir, 'references/api.md'), 'utf8')).toBe('# api reference\n')
    expect([...readFileSync(join(companionDir, 'assets/logo.bin'))]).toEqual([0, 1, 2, 253, 254, 255])

    // The lockfile records all three owned files with recomputed hashes.
    const written = CurrentLockfileSchema(JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')))
    if (written instanceof type.errors) expect.unreachable()
    const asset = written.facets['viper-plans']?.assets[0]
    expect(asset?.files.map((f) => f.path)).toEqual([
      'skills/planning/SKILL.md',
      'skills/planning/assets/logo.bin',
      'skills/planning/references/api.md',
    ])
  })

  test('reinstall skips an unchanged bundle, then repairs a single drifted companion', async () => {
    const local = buildBundleFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )
    const adapters = [buildBundleAdapter('bundle')]

    const first = await runInstall({ projectRoot, adapters })
    if (!first.ok) expect.unreachable()
    expect(first.summary.textAssets.written).toBe(1)

    // Second install with no changes: the whole bundle is identical → skipped.
    const second = await runInstall({ projectRoot, adapters })
    if (!second.ok) expect.unreachable()
    expect(second.summary.textAssets.written).toBe(0)

    // Drift a single companion on disk, then reinstall: the bundle is
    // repaired (one write) and the drifted file is restored from source. The
    // verbose log names the exact drifted path (path-specific drift, 9.7).
    const apiPath = join(projectRoot, '.bundle/skills/planning/references/api.md')
    writeFileSync(apiPath, '# TAMPERED\n')
    const logs: string[] = []
    const third = await runInstall({ projectRoot, adapters, onLog: (b) => logs.push(b()) })
    if (!third.ok) expect.unreachable()
    expect(third.summary.textAssets.written).toBe(1)
    expect(readFileSync(apiPath, 'utf8')).toBe('# api reference\n')
    expect(logs.some((l) => l.includes('drift: skills/planning/references/api.md'))).toBe(true)
  })

  test('an unowned file in the skill directory survives an update', async () => {
    const local = buildBundleFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )
    const adapters = [buildBundleAdapter('bundle')]

    const first = await runInstall({ projectRoot, adapters })
    if (!first.ok) expect.unreachable()

    // A user drops an unowned note into the skill dir.
    const notePath = join(projectRoot, '.bundle/skills/planning/notes.txt')
    writeFileSync(notePath, 'my notes\n')

    // Change the primary so a reinstall re-writes the bundle.
    writeFileSync(join(local, 'skills/planning/SKILL.md'), '# planning edited\n')
    const second = await runInstall({ projectRoot, adapters })
    if (!second.ok) expect.unreachable()

    // The unowned note is untouched by the owned-set replacement.
    expect(readFileSync(notePath, 'utf8')).toBe('my notes\n')
  })

  // 9.7: offline multi-file cleanup from the receipt. After install, removing
  // the facet (empty manifest) deletes the primary AND every owned companion
  // using only the receipt's recorded owned paths — no cache, no network —
  // while preserving unowned files.
  test('removal deletes owned companions offline from the receipt, preserving unowned files', async () => {
    const local = buildBundleFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )
    const adapters = [buildBundleAdapter('bundle')]

    const first = await runInstall({ projectRoot, adapters })
    if (!first.ok) expect.unreachable()

    const skillDir = join(projectRoot, '.bundle/skills/planning')
    const apiPath = join(skillDir, 'references/api.md')
    const logoPath = join(skillDir, 'assets/logo.bin')
    const notePath = join(skillDir, 'notes.txt')
    expect(existsSync(apiPath)).toBe(true)
    expect(existsSync(logoPath)).toBe(true)
    // A user file that the receipt does not own.
    writeFileSync(notePath, 'keep me\n')

    // Delete the source fixture so nothing can be re-derived from it, and
    // empty the manifest to trigger receipt-driven removal.
    rmSync(local, { recursive: true, force: true })
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: {} }))

    const removed = await runInstall({ projectRoot, adapters })
    if (!removed.ok) expect.unreachable()

    // Primary + both owned companions removed; the unowned note survives.
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(false)
    expect(existsSync(apiPath)).toBe(false)
    expect(existsSync(logoPath)).toBe(false)
    expect(readFileSync(notePath, 'utf8')).toBe('keep me\n')
  })

  // 9.9: archive-only supplementary files (e.g. a root README.md) ship in the
  // verified archive and are pinned by facet integrity, but are NEVER
  // materialized to an adapter and NEVER recorded as a lockfile asset.
  test('an archive-only README is verified but never materialized or locked', async () => {
    const repo = realpathSync(mkdtempSync(join(projectRoot, 'archiveonly-fixture-')))
    writeFileSync(
      join(repo, 'facet.json'),
      JSON.stringify({
        name: 'viper-plans',
        version: '0.1.0',
        skills: { planning: { description: 'planning skill' } },
        files: ['README.md'],
      }),
    )
    mkdirSync(join(repo, 'skills/planning'), { recursive: true })
    writeFileSync(join(repo, 'skills/planning/SKILL.md'), '# planning\n')
    writeFileSync(join(repo, 'README.md'), '# my facet\n')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${repo.split('/').pop()}` } }),
    )

    const result = await runInstall({ projectRoot, adapters: [buildBundleAdapter('bundle')] })
    if (!result.ok) expect.unreachable()

    // README is NOT written into the adapter tree anywhere.
    expect(existsSync(join(projectRoot, '.bundle/README.md'))).toBe(false)
    expect(existsSync(join(projectRoot, '.bundle/skills/planning/README.md'))).toBe(false)

    // No lockfile asset lists README.md among its files.
    const written = CurrentLockfileSchema(JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')))
    if (written instanceof type.errors) expect.unreachable()
    for (const asset of written.facets['viper-plans']?.assets ?? []) {
      expect(asset.files.some((f) => f.path === 'README.md')).toBe(false)
    }
  })

  // 9.10: interrupted-install convergence. A crash can leave a partial bundle
  // (primary present, a companion missing). Re-running install compares the
  // on-disk bundle to the source and repairs it, converging without deleting
  // any unowned file.
  test('re-running install converges a partially-materialized bundle without deleting unowned files', async () => {
    const local = buildBundleFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )
    const adapters = [buildBundleAdapter('bundle')]

    const first = await runInstall({ projectRoot, adapters })
    if (!first.ok) expect.unreachable()

    const skillDir = join(projectRoot, '.bundle/skills/planning')
    // Simulate an interrupted install: a companion is missing on disk, and an
    // unowned user file is present.
    rmSync(join(skillDir, 'references/api.md'), { force: true })
    const notePath = join(skillDir, 'notes.txt')
    writeFileSync(notePath, 'keep me\n')

    // Re-run converges: the missing companion is restored, the unowned file
    // survives, and the install reports the bundle as repaired (one write).
    const second = await runInstall({ projectRoot, adapters })
    if (!second.ok) expect.unreachable()
    expect(second.summary.textAssets.written).toBe(1)
    expect(readFileSync(join(skillDir, 'references/api.md'), 'utf8')).toBe('# api reference\n')
    expect(readFileSync(notePath, 'utf8')).toBe('keep me\n')
  })

  // Frozen reproduction must be a no-op on an already-correct bundle. When a
  // resolver could return identity without content, the absent companion map
  // was indistinguishable from "this skill has no companions", so the bundle
  // replacement removed every owned companion and still reported success.
  test('a frozen install leaves an already-correct skill bundle intact', async () => {
    const local = buildBundleFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )
    const adapters = [buildBundleAdapter('bundle')]

    const first = await runInstall({ projectRoot, adapters })
    if (!first.ok) expect.unreachable()
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')

    const frozen = await runInstall({ projectRoot, adapters, frozenLockfile: true })
    if (!frozen.ok) expect.unreachable()

    // Nothing written, and every companion survives.
    expect(frozen.summary.textAssets.written).toBe(0)
    expect(frozen.perFacet).toEqual([{ kind: 'unchanged', name: 'viper-plans', version: '0.1.0' }])
    const skillDir = join(projectRoot, '.bundle/skills/planning')
    expect(readFileSync(join(skillDir, 'references/api.md'), 'utf8')).toBe('# api reference\n')
    expect([...readFileSync(join(skillDir, 'assets/logo.bin'))]).toEqual([0, 1, 2, 253, 254, 255])
    // Frozen never rewrites the lockfile.
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })

  test('a frozen install repairs a drifted companion from verified bytes', async () => {
    const local = buildBundleFixture('viper-plans')
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({ facets: { 'viper-plans': `./${local.split('/').pop()}` } }),
    )
    const adapters = [buildBundleAdapter('bundle')]

    const first = await runInstall({ projectRoot, adapters })
    if (!first.ok) expect.unreachable()

    const skillDir = join(projectRoot, '.bundle/skills/planning')
    rmSync(join(skillDir, 'references/api.md'), { force: true })

    // Frozen mode constrains the locked set, not materialized state: it still
    // converges disk, which is only possible because the resolved record
    // carries the companion bytes to restore from.
    const frozen = await runInstall({ projectRoot, adapters, frozenLockfile: true })
    if (!frozen.ok) expect.unreachable()
    expect(frozen.perFacet).toEqual([{ kind: 'repaired', name: 'viper-plans', version: '0.1.0' }])
    expect(readFileSync(join(skillDir, 'references/api.md'), 'utf8')).toBe('# api reference\n')
  })
})
