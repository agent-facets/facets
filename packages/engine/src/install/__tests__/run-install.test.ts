import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for `runInstall`'s manifest-vs-lockfile reconciliation.
 *
 * The registry resolve + download path is stubbed via `mock.module` so the
 * test exercises the satisfy-or-re-resolve logic without a live registry.
 * The resolver echoes back the exact version it was ASKED for (recording
 * each request), and 404s a designated nonexistent version — so a test can
 * assert that install fetched the MANIFEST's version, not the locked one.
 * The download stub copies a local fixture (built to match the resolved
 * version) into the staging dir; everything downstream (build, content
 * hash, materialize, lockfile) runs for real.
 */

// --- Registry mock state (mutated per-test before calling runInstall) -----

type FixtureForVersion = (version: string) => string | null
let fixtureForVersion: FixtureForVersion = () => null
let resolveRequests: Array<{ name: string; version: string }> = []
let nonexistentVersions = new Set<string>()

/** Render a VersionSpec the way the engine describes it for the registry. */
function describeSpec(spec: { kind: string; major?: number; minor?: number; patch?: number }): string {
  switch (spec.kind) {
    case 'exact':
      return `${spec.major}.${spec.minor}.${spec.patch}`
    case 'majorWildcard':
      return `${spec.major}.*`
    case 'minorWildcard':
      return `${spec.major}.${spec.minor}.*`
    default:
      return spec.kind === 'latest' ? 'latest' : '*'
  }
}

mock.module('../../registry/resolve-metadata.ts', () => ({
  resolveRegistryMetadataBatch: async (
    specs: ReadonlyArray<{ name: string; version: { kind: string; major?: number; minor?: number; patch?: number } }>,
  ) => {
    const spec = specs[0]
    if (spec === undefined) return { ok: true, value: [] }
    const requested = describeSpec(spec.version)
    resolveRequests.push({ name: spec.name, version: requested })
    if (nonexistentVersions.has(requested)) {
      return { ok: false, error: { code: 'NOT_FOUND', name: spec.name, spec: requested } }
    }
    // Exact specifiers resolve to themselves; wildcard/latest resolve to a
    // representative published version the test sets via fixtureForVersion.
    const resolved = spec.version.kind === 'exact' ? requested : (resolveRequests.at(-1)?.version ?? requested)
    return {
      ok: true,
      value: [{ name: spec.name, version: resolved, expectedIntegrity: 'sha256:stub' }],
    }
  },
}))

mock.module('../../registry/download.ts', () => ({
  downloadAndExtractFacet: async (meta: { name: string; version: string }, dest: string) => {
    const fixture = fixtureForVersion(meta.version)
    if (fixture === null) {
      return { ok: false, error: { code: 'NETWORK_ERROR', cause: `no fixture for ${meta.version}`, attempts: 1 } }
    }
    cpSync(fixture, dest, { recursive: true })
    return { ok: true, value: undefined }
  },
}))

const { runInstall } = await import('../run-install.ts')
const { loadInstalledAdapters } = await import('../../adapters/loader.ts')
const { runBuildPipeline } = await import('../../build/pipeline.ts')
const { LOCKFILE_VERSION } = await import('@agent-facets/protocol')

/** Build a fixture and return the genuine content-hash the install pipeline
 *  would compute for it — so a satisfying lock entry can carry a real
 *  integrity that passes the tag-move guard. */
async function realIntegrity(fixtureDir: string): Promise<string> {
  const built = await runBuildPipeline(fixtureDir, [])
  if (!built.ok) throw new Error('test bug: fixture failed to build')
  return built.integrity
}

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined
let adaptersDir: string

function buildFixture(parent: string, name: string, version: string): string {
  const repo = realpathSync(mkdtempSync(join(parent, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({ name, version, skills: { planning: { description: 'planning skill' } } }),
  )
  mkdirSync(join(repo, 'skills/planning'), { recursive: true })
  writeFileSync(join(repo, 'skills/planning/SKILL.md'), `# planning ${version}\n`)
  return repo
}

function installFakeAdapter(baseDir: string, name: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  const assetFsImport = require.resolve('@agent-facets/adapter')
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { installAssetFile, readAssetFile, deleteAssetFile } from '${assetFsImport}'
import { join } from 'node:path'
function path(type, name) { return join(process.cwd(), '.${name}', type + 's', name + '.md') }
export default {
  name: '${name}',
  supportsInstall: true,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  async installAsset(scope, type, name, content, metadata) { await installAssetFile({ file: path(type, name) }, content, metadata) },
  async readAsset(scope, type, name) { return readAssetFile({ file: path(type, name) }) },
  async deleteAsset(scope, type, name) { await deleteAssetFile({ file: path(type, name) }) },
}
`,
  )
}

function writeFacets(facets: Record<string, string>): string {
  const bytes = `${JSON.stringify({ facets }, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.json'), bytes)
  return bytes
}

/** Seed a lockfile entry. `integrity` defaults to the stub the download path uses. */
function writeLock(facets: Record<string, { source: string; version: string; integrity?: string }>): string {
  const entries: Record<string, unknown> = {}
  for (const [name, e] of Object.entries(facets)) {
    entries[name] = {
      source: e.source,
      version: e.version,
      integrity: e.integrity ?? 'sha256:stub',
      assets: [{ scope: 'user', type: 'skill', name: 'planning' }],
    }
  }
  const bytes = `${JSON.stringify({ lockfileVersion: LOCKFILE_VERSION, facets: entries }, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.lock'), bytes)
  return bytes
}

function readLock(): {
  facets: Record<string, { source: string; version: string; integrity: string }>
} {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
}

async function install() {
  const adapters = await loadInstalledAdapters()
  return runInstall({ projectRoot, adapters: adapters.filter((a) => a.supportsInstall === true) })
}

async function installFrozen() {
  const adapters = await loadInstalledAdapters()
  return runInstall({
    projectRoot,
    adapters: adapters.filter((a) => a.supportsInstall === true),
    frozenLockfile: true,
  })
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-runinstall-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
  installFakeAdapter(adaptersDir, 'test-adapter')
  fixtureForVersion = () => null
  resolveRequests = []
  nonexistentVersions = new Set()
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('runInstall — exact manifest pin differing from the lockfile', () => {
  test('re-resolves to the manifest version and reports updated', async () => {
    // Fixtures exist for both versions; the lock pins 0.1.1, manifest bumps to 0.1.2.
    fixtureForVersion = (v) => (v === '0.1.2' ? buildFixture(fakeHome, 'cowsay', '0.1.2') : null)
    writeFacets({ cowsay: '0.1.2' })
    writeLock({ cowsay: { source: '0.1.1', version: '0.1.1' } })

    const result = await install()
    if (!result.ok) expect.unreachable()

    // Install fetched the MANIFEST version, not the locked one.
    expect(resolveRequests).toEqual([{ name: 'cowsay', version: '0.1.2' }])
    // The lockfile now records the re-resolved version.
    expect(readLock().facets.cowsay?.version).toBe('0.1.2')
    // The outcome is reported as an update from 0.1.1 → 0.1.2.
    const outcome = result.perFacet.find((o) => o.name === 'cowsay')
    if (outcome === undefined) expect.unreachable()
    if (outcome.kind !== 'updated') expect.unreachable()
    expect(outcome.oldVersion).toBe('0.1.1')
    expect(outcome.newVersion).toBe('0.1.2')
  })

  test('fails on a version that does not exist and leaves the project unchanged', async () => {
    nonexistentVersions = new Set(['0.1.2'])
    const facetsBefore = writeFacets({ cowsay: '0.1.2' })
    const lockBefore = writeLock({ cowsay: { source: '0.1.1', version: '0.1.1' } })

    const result = await install()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'REGISTRY_ERROR') expect.unreachable()
    expect(result.failure.error.code).toBe('NOT_FOUND')

    // It tried to resolve the bumped version (and only that).
    expect(resolveRequests).toEqual([{ name: 'cowsay', version: '0.1.2' }])
    // Manifest and lockfile are byte-for-byte unchanged.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
    // The nonexistent version was never recorded.
    expect(readLock().facets.cowsay?.version).toBe('0.1.1')
  })
})

describe('runInstall — wildcard manifest vs lockfile', () => {
  test('honors the locked version (not the wildcard) when the lock satisfies the manifest', async () => {
    // Manifest 1.* satisfied by locked 1.2.3. On a cold cache the install
    // fetches the LOCKED version 1.2.3 for reproducibility — it must NOT
    // re-resolve the manifest's `1.*` (which could drift to a newer 1.x).
    const fixture = buildFixture(fakeHome, 'cowsay', '1.2.3')
    fixtureForVersion = (v) => (v === '1.2.3' ? fixture : null)
    writeFacets({ cowsay: '1.*' })
    // Real integrity so the satisfying-lock tag-move guard passes.
    writeLock({ cowsay: { source: '1.*', version: '1.2.3', integrity: await realIntegrity(fixture) } })

    const result = await install()
    if (!result.ok) expect.unreachable()

    // Resolution was pinned to the locked exact version, never the wildcard.
    expect(resolveRequests).toEqual([{ name: 'cowsay', version: '1.2.3' }])
    expect(readLock().facets.cowsay?.version).toBe('1.2.3')
    const outcome = result.perFacet.find((o) => o.name === 'cowsay')
    if (outcome === undefined) expect.unreachable()
    // Same version in and out → not an update.
    expect(outcome.kind).not.toBe('updated')
  })

  test('re-resolves when the locked version no longer satisfies the wildcard', async () => {
    // Manifest widened to 2.*, lock still at 1.2.3 → stale → re-resolve.
    fixtureForVersion = (v) => (v === '2.*' ? buildFixture(fakeHome, 'cowsay', '2.0.0') : null)
    // Wildcard resolves to the requested wildcard string in the mock, and the
    // download fixture is keyed on that string; the built facet's version is 2.0.0.
    writeFacets({ cowsay: '2.*' })
    writeLock({ cowsay: { source: '1.*', version: '1.2.3' } })

    const result = await install()
    if (!result.ok) expect.unreachable()

    // It re-resolved against the manifest's wildcard rather than honoring 1.2.3.
    expect(resolveRequests).toEqual([{ name: 'cowsay', version: '2.*' }])
    // The lockfile now records the freshly built version, not the stale 1.2.3.
    expect(readLock().facets.cowsay?.version).toBe('2.0.0')
  })
})

describe('runInstall — frozen-lockfile mode', () => {
  test('proceeds when the lockfile covers the manifest and writes nothing', async () => {
    const fixture = buildFixture(fakeHome, 'cowsay', '0.1.1')
    fixtureForVersion = (v) => (v === '0.1.1' ? fixture : null)
    writeFacets({ cowsay: '0.1.1' })
    const lockBefore = writeLock({
      cowsay: { source: '0.1.1', version: '0.1.1', integrity: await realIntegrity(fixture) },
    })

    const result = await installFrozen()
    if (!result.ok) expect.unreachable()

    // No re-resolution; resolution pinned to the locked version on cache miss.
    expect(resolveRequests).toEqual([{ name: 'cowsay', version: '0.1.1' }])
    // The lockfile is byte-for-byte unchanged (never written in frozen mode).
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })

  test('fails on an orphaned lockfile entry without pruning anything', async () => {
    // `stale` is pinned in the lockfile but absent from the manifest. In
    // frozen mode the drift-removal loop would otherwise delete its assets
    // while the lockfile write is skipped — leaving adapter state mutated and
    // the orphan entry stranded. The preflight must catch it first.
    const facetsBefore = writeFacets({ cowsay: '0.1.1' })
    const lockBefore = writeLock({
      cowsay: { source: '0.1.1', version: '0.1.1' },
      stale: { source: '4.5.6', version: '4.5.6' },
    })

    const result = await installFrozen()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    expect(result.failure.facets).toEqual([{ name: 'stale', reason: 'orphaned', lockedVersion: '4.5.6' }])
    // Nothing was resolved and both project files are byte-for-byte unchanged.
    expect(resolveRequests).toEqual([])
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })

  test('fails when no lockfile exists', async () => {
    const facetsBefore = writeFacets({ cowsay: '0.1.1' })

    const result = await installFrozen()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    expect(result.failure.facets).toEqual([{ name: 'cowsay', reason: 'missing-lockfile', manifestSpec: '0.1.1' }])
    // Never resolved; project untouched; no lockfile created.
    expect(resolveRequests).toEqual([])
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(() => readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toThrow()
  })

  test('fails when a manifest facet is missing from the lockfile', async () => {
    writeFacets({ cowsay: '0.1.1', extra: '0.2.0' })
    writeLock({ cowsay: { source: '0.1.1', version: '0.1.1' } })

    const result = await installFrozen()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    expect(result.failure.facets).toEqual([{ name: 'extra', reason: 'no-entry', manifestSpec: '0.2.0' }])
    expect(resolveRequests).toEqual([])
  })

  test('fails when the locked version does not satisfy the manifest specifier', async () => {
    writeFacets({ cowsay: '0.1.2' })
    writeLock({ cowsay: { source: '0.1.1', version: '0.1.1' } })

    const result = await installFrozen()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    expect(result.failure.facets).toEqual([
      { name: 'cowsay', reason: 'unsatisfied', manifestSpec: '0.1.2', lockedVersion: '0.1.1' },
    ])
    // The lockfile is never re-resolved or updated.
    expect(resolveRequests).toEqual([])
    expect(readLock().facets.cowsay?.version).toBe('0.1.1')
  })
})
