import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import type { BuildManifest } from '@agent-facets/protocol'

/**
 * Tests for `runInstall`'s manifest-vs-lockfile reconciliation.
 *
 * The registry resolve + download path is stubbed via `mock.module` so the
 * test exercises the satisfy-or-re-resolve logic without a live registry.
 * The resolver echoes back the exact version it was ASKED for (recording
 * each request), and 404s a designated nonexistent version — so a test can
 * assert that install fetched the MANIFEST's version, not the locked one.
 *
 * All hash material is GENUINE: the metadata stub publishes the fixture's
 * real canonical fingerprint and the download stub returns the fixture's
 * real build manifest, so the per-version materialization chain (Check B,
 * the post-download recompute, Check C, the verified cache put) runs for
 * real — only network I/O is stubbed.
 */

// --- Registry mock state (mutated per-test before calling runInstall) -----

type FixtureForVersion = (version: string) => string | null
let fixtureForVersion: FixtureForVersion = () => null
let resolveRequests: Array<{ name: string; version: string }> = []
let nonexistentVersions = new Set<string>()
/** Map of requested non-exact spec (e.g. `2.*`) → the exact version the stub registry resolves it to. */
let wildcardResolutions: Record<string, string> = {}

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

/** Build the fixture's genuine build manifest — the same artifact a real
 *  registry would serve in the outer tar. */
async function manifestFor(fixtureDir: string): Promise<BuildManifest> {
  const { runBuildPipeline } = await import('../../build/pipeline.ts')
  const built = await runBuildPipeline(fixtureDir, [])
  if (!built.ok) throw new Error('test bug: fixture failed to build')
  return JSON.parse(built.manifestJson) as BuildManifest
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
    // Exact specifiers resolve to themselves; wildcard/latest resolve via
    // the per-test wildcardResolutions map.
    const resolved = spec.version.kind === 'exact' ? requested : (wildcardResolutions[requested] ?? requested)
    // The published canonical fingerprint must be GENUINE — the chain
    // compares it against the manifest claim (Check B) and the audited
    // content (Check A). Without a fixture there is nothing to
    // fingerprint; a chain that consults the stub value fails closed,
    // which is exactly what those tests assert.
    const fixture = fixtureForVersion(resolved)
    const contentFingerprint = fixture === null ? 'sha256:stub' : (await manifestFor(fixture)).integrity
    return {
      ok: true,
      value: [{ name: spec.name, version: resolved, transportHash: 'sha256:stub', contentFingerprint }],
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
    const manifest = await manifestFor(fixture)
    return { ok: true, value: { integrity: manifest.integrity, fileHashes: manifest.assets } }
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
  apiVersion: '${ADAPTER_API_VERSION}',
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

/** Convert an OLD flat `source` string into the NEW tagged lockfile source.
 *  Git sources carry the resolved commit (placeholder when the caller does
 *  not supply one). */
function taggedSource(source: string, commit?: string): unknown {
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || source.startsWith('file:')) {
    return { kind: 'local', path: source }
  }
  if (source.startsWith('github:') || source.includes('git@') || source.endsWith('.git') || source.includes('://')) {
    return { kind: 'git', url: source, commit: commit ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
  }
  return { kind: 'registry', registry: 'https://api.agentfacets.io' }
}

/** Seed a lockfile entry. `integrity` defaults to the stub the download path uses. */
function writeLock(facets: Record<string, { source: string; version: string; integrity?: string }>): string {
  const entries: Record<string, unknown> = {}
  for (const [name, e] of Object.entries(facets)) {
    entries[name] = {
      source: taggedSource(e.source),
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
  facets: Record<string, { source: unknown; version: string; integrity: string }>
} {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
}

async function install() {
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters
  return runInstall({ projectRoot, adapters: adapters.filter((a) => a.supportsInstall === true) })
}

async function installFrozen() {
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters
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
  wildcardResolutions = {}
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

describe('runInstall — DELTA_CONFLICT (#23)', () => {
  test('a delta with the same facet in additions and removals fails before any mutation', async () => {
    writeFacets({ cowsay: '0.1.0' })
    const loadResult = await loadInstalledAdapters()
    if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
    const adapters = loadResult.adapters
    const result = await runInstall({
      projectRoot,
      adapters: adapters.filter((a) => a.supportsInstall === true),
      delta: {
        additions: [
          {
            facetName: 'cowsay',
            specifier: 'cowsay@0.1.0',
            source: { kind: 'registry', name: 'cowsay', version: { kind: 'exact', major: 0, minor: 1, patch: 0 } },
          },
        ],
        removals: [{ facetName: 'cowsay' }],
      },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('DELTA_CONFLICT')
    if (result.failure.code !== 'DELTA_CONFLICT') expect.unreachable()
    expect(result.failure.facet).toBe('cowsay')
    expect(result.rollback.kind).toBe('not-needed')
  })
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
    // The stub registry resolves `2.*` to its newest published 2.x.
    wildcardResolutions = { '2.*': '2.0.0' }
    const fixture = buildFixture(fakeHome, 'cowsay', '2.0.0')
    fixtureForVersion = (v) => (v === '2.0.0' ? fixture : null)
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

  test('fails on a git source-string change without resolving or mutating', async () => {
    // The lockfile pins a git URL; the manifest now points the same facet
    // name at a different repo. Frozen mode must reject this at the preflight
    // (before any clone) so it never builds from the unlocked origin.
    const facetsBefore = writeFacets({ planner: 'github:attacker/planner' })
    const lockBefore = writeLock({
      planner: { source: 'github:agent-facets/planner', version: '2.0.0' },
    })

    const result = await installFrozen()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    expect(result.failure.facets).toEqual([
      {
        name: 'planner',
        reason: 'source-changed',
        manifestSpec: 'github:attacker/planner',
        lockedSource: 'github:agent-facets/planner',
      },
    ])
    // Never resolved/cloned; both project files byte-for-byte unchanged.
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

  test('fails on local content drift with INTEGRITY_FAILURE and no mutation', async () => {
    // A local facet whose source path is unchanged but whose CONTENT was
    // edited. A normal install would rebuild and overwrite the entry, but
    // frozen mode must reproduce the locked integrity exactly — so an edited
    // local source blows up just like a git tag move, mutating nothing.
    const localDir = join(projectRoot, 'local-cowsay')
    mkdirSync(join(localDir, 'skills/planning'), { recursive: true })
    writeFileSync(
      join(localDir, 'facet.json'),
      JSON.stringify({ name: 'cowsay', version: '1.0.0', skills: { planning: { description: 'planning skill' } } }),
    )
    writeFileSync(join(localDir, 'skills/planning/SKILL.md'), '# edited content that does not match the lock\n')

    const facetsBefore = writeFacets({ cowsay: './local-cowsay' })
    // Lock a deliberately wrong integrity so the freshly-built local content
    // cannot reproduce it.
    const lockBefore = writeLock({
      cowsay: { source: './local-cowsay', version: '1.0.0', integrity: 'sha256:deadbeefdeadbeefdeadbeefdeadbeef' },
    })

    const result = await installFrozen()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'INTEGRITY_FAILURE') expect.unreachable()
    // The failure is labeled `lockfile`, not `git`: a local-content drift is
    // a built-vs-lockfile divergence, and reporting `git` here would mislead
    // the user (nothing git happened).
    if (result.failure.failure.kind !== 'facet') expect.unreachable()
    expect(result.failure.failure.check).toBe('lockfile')
    // Project files are byte-for-byte unchanged (no rewrite, no materialize).
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })
})

describe('runInstall — ADAPTER_INCOMPATIBLE preflight', () => {
  /** Structurally valid adapter with an unsupported API; methods throw loud. */
  function incompatibleAdapter(name: string, apiVersion: unknown): Adapter {
    return {
      name,
      apiVersion,
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
    } as Adapter
  }

  test('fails on the no-mutation path before any facet processing or write', async () => {
    // The manifest content is irrelevant: the preflight fires before any
    // facet is parsed, resolved, or built.
    const manifestBytes = writeFacets({ 'gate-facet': './some-local-facet' })

    const result = await runInstall({
      projectRoot,
      adapters: [incompatibleAdapter('future-adapter', '9.9')],
    })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'ADAPTER_INCOMPATIBLE') expect.unreachable()
    expect(result.failure.failures).toEqual([
      { kind: 'api-unsupported', adapter: 'future-adapter', found: '9.9', supported: [ADAPTER_API_VERSION] },
    ])
    expect(result.rollback.kind).toBe('not-needed')

    // No writes: manifest byte-identical, no lockfile created, no
    // install receipt written (the receipt only exists after a
    // successful tri-write).
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(manifestBytes)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    const { receiptPath } = await import('../receipt.ts')
    expect(existsSync(receiptPath(projectRoot))).toBe(false)
  })

  test('collects every incompatible adapter', async () => {
    writeFacets({})
    const result = await runInstall({
      projectRoot,
      adapters: [incompatibleAdapter('undeclared', undefined), incompatibleAdapter('malformed', '0.0.1')],
    })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'ADAPTER_INCOMPATIBLE') expect.unreachable()
    expect(result.failure.failures.map((f) => f.kind)).toEqual(['api-missing', 'api-malformed'])
  })
})
