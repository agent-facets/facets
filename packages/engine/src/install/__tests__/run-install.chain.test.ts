import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import type { BuildManifest, CurrentBuildManifest, Lockfile02Facet, ProjectFacetEntry } from '@agent-facets/protocol'
import { LOCKFILE_VERSION_0_2 } from '@agent-facets/protocol'
import type { Addition } from '../types.ts'

/**
 * Spec-scenario coverage for the registry per-version materialization
 * chain through `runInstall` (`diagrams/committing.md`): confirming-hit,
 * locked-hit, tampered-cache eviction, the audited lockfile mismatch,
 * the structural discriminator, and frozen-mode chain behavior.
 *
 * All hash material is GENUINE (fixtures are hashed for real; cache
 * slots are seeded through the real verified-put); only network I/O is
 * stubbed. The stubs RECORD every metadata request and download so
 * tests can assert what was — and was not — fetched.
 */

// --- Registry mock state (mutated per-test before calling runInstall) -----

type FixtureForVersion = (version: string) => string | null
let fixtureForVersion: FixtureForVersion = () => null
let resolveRequests: Array<{ name: string; version: string }> = []
let downloadCalls: string[] = []
/** When true, every metadata request fails with NETWORK_ERROR (offline). */
let metadataOffline = false
/** Map of requested non-exact spec (e.g. `0.*`) → resolved exact version. */
let wildcardResolutions: Record<string, string> = {}
/** When set, overrides the published canonical fingerprint (e.g. `''`). */
let fingerprintOverride: string | null = null

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

async function manifestFor(fixtureDir: string): Promise<CurrentBuildManifest> {
  const { runBuildPipeline } = await import('../../build/pipeline.ts')
  const built = await runBuildPipeline(fixtureDir, [])
  if (!built.ok) throw new Error('test bug: fixture failed to build')
  return JSON.parse(built.manifestJson) as CurrentBuildManifest
}

mock.module('../../registry/resolve-metadata.ts', () => ({
  resolveRegistryMetadataBatch: async (
    specs: ReadonlyArray<{ name: string; version: { kind: string; major?: number; minor?: number; patch?: number } }>,
  ) => {
    const spec = specs[0]
    if (spec === undefined) return { ok: true, value: [] }
    const requested = describeSpec(spec.version)
    resolveRequests.push({ name: spec.name, version: requested })
    if (metadataOffline) {
      return { ok: false, error: { code: 'NETWORK_ERROR', cause: 'simulated offline', attempts: 3 } }
    }
    const resolved = spec.version.kind === 'exact' ? requested : (wildcardResolutions[requested] ?? requested)
    const fixture = fixtureForVersion(resolved)
    const contentFingerprint =
      fingerprintOverride ?? (fixture === null ? 'sha256:stub' : (await manifestFor(fixture)).integrity)
    return {
      ok: true,
      value: [{ name: spec.name, version: resolved, transportHash: 'sha256:stub', contentFingerprint }],
    }
  },
}))

mock.module('../../registry/download.ts', () => ({
  downloadAndExtractFacet: async (meta: { name: string; version: string }, dest: string) => {
    downloadCalls.push(meta.version)
    const fixture = fixtureForVersion(meta.version)
    if (fixture === null) {
      return { ok: false, error: { code: 'NETWORK_ERROR', cause: `no fixture for ${meta.version}`, attempts: 1 } }
    }
    cpSync(fixture, dest, { recursive: true })
    const manifest = await manifestFor(fixture)
    return { ok: true, value: { integrity: manifest.integrity, fileHashes: manifest.files } }
  },
}))

const { runInstall } = await import('../run-install.ts')
const { loadInstalledAdapters } = await import('../../adapters/loader.ts')
const { parseFacetSource } = await import('../../sources/facet/parse-source.ts')
const { cachePath, cachePutVerified, cacheStagingDir, computeDirIntegrity } = await import('../../cache/index.ts')

// --- Project / fixture helpers ---------------------------------------------

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined

const FIXTURE_FILES = ['facet.json', 'skills/planning/SKILL.md']

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

/**
 * Seed a real registry cache slot via the verified-put path, from the
 * same content `buildFixture` produces — so a paired fixture (for the
 * metadata fingerprint or a re-download) hashes identically.
 */
function seedRegistrySlot(
  name: string,
  version: string,
): { slotPath: string; integrity: string; fixture: string; skillIntegrity: string } {
  const fixture = buildFixture(fakeHome, name, version)
  const staging = cacheStagingDir()
  cpSync(fixture, staging, { recursive: true })
  const computed = computeDirIntegrity(staging, FIXTURE_FILES)
  if (!computed.ok) throw new Error('test bug: staged fixture unreadable')
  const skillIntegrity = computed.assetHashes['skills/planning/SKILL.md']
  if (skillIntegrity === undefined) throw new Error('test bug: fixture has no planning skill')
  const manifest: BuildManifest = {
    facetVersion: 0.1,
    archive: 'archive.tar.gz',
    integrity: computed.integrity,
    assets: computed.assetHashes,
  }
  const put = cachePutVerified(
    { kind: 'registry', name, version },
    staging,
    { integrity: manifest.integrity, fileHashes: manifest.assets },
    computed.integrity,
    name,
  )
  if (!put.ok) throw new Error('test bug: seeding cache slot failed')
  return { slotPath: put.path, integrity: computed.integrity, fixture, skillIntegrity }
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
  async installAsset(req) {
    const file = path(req.assetType, req.name)
    await installAssetFile({ file }, req.content, req.metadata)
    return { ok: true, primaryPath: file }
  },
  async readAsset(req) {
    try {
      const r = await readAssetFile({ file: path(req.assetType, req.name) })
      return {
        ok: true,
        asset: req.assetType === 'skill'
          ? { assetType: 'skill', content: r.content, metadata: r.metadata, companions: {} }
          : { assetType: req.assetType, content: r.content, metadata: r.metadata },
      }
    } catch {
      return { ok: false, failure: { code: 'not-found' } }
    }
  },
  async deleteAsset(req) {
    const file = path(req.assetType, req.name)
    await deleteAssetFile({ file })
    return { ok: true, existed: true, deletedPaths: [file] }
  },
}
`,
  )
}

function writeFacets(facets: Record<string, ProjectFacetEntry>): string {
  const bytes = `${JSON.stringify({ facets }, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.json'), bytes)
  return bytes
}

/**
 * Seed a `0.2` lockfile entry.
 *
 * `skillIntegrity` is the fixture's real per-file hash whenever the entry's
 * facet integrity is real: a matching facet integrity means REPRODUCTION, so
 * per-file reconciliation runs and a stub hash would fail it for the wrong
 * reason. The locked scope is `project` for the same class of reason — the
 * verified plan derives `project`, and a locked `user` would be genuine
 * identity drift rather than a fixture detail.
 */
function writeLock(facets: Record<string, { version: string; integrity: string; skillIntegrity?: string }>): string {
  const entries: Record<string, Lockfile02Facet> = {}
  for (const [name, e] of Object.entries(facets)) {
    entries[name] = {
      source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
      version: e.version,
      integrity: e.integrity,
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'planning',
          files: [{ path: 'skills/planning/SKILL.md', integrity: e.skillIntegrity ?? `sha256:${'0'.repeat(64)}` }],
        },
      ],
    }
  }
  const bytes = `${JSON.stringify({ lockfileVersion: LOCKFILE_VERSION_0_2, facets: entries }, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.lock'), bytes)
  return bytes
}

function readLock(): { facets: Record<string, { version: string; integrity: string }> } {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
}

/**
 * A facets.json entry is `string | { source, materialization }`. Typing
 * these helpers as a flat string map made the expanded form unrepresentable,
 * so a suite using them could not cover aliasing even if it wanted to.
 */
function readFacets(): Record<string, ProjectFacetEntry> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets
}

function registryAddition(specifier: string): Addition {
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok || parsed.value.kind !== 'registry') throw new Error(`test bug: not a registry specifier`)
  return { facetName: parsed.value.name, specifier, source: parsed.value }
}

async function install(opts: { additions?: Addition[]; frozen?: boolean } = {}) {
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters
  return runInstall({
    projectRoot,
    adapters: adapters.filter((a) => a.supportsInstall === true),
    delta: opts.additions ? { additions: opts.additions, removals: [] } : undefined,
    frozenLockfile: opts.frozen,
  })
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-chain-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  const adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
  installFakeAdapter(adaptersDir, 'test-adapter')
  fixtureForVersion = () => null
  resolveRequests = []
  downloadCalls = []
  metadataOffline = false
  wildcardResolutions = {}
  fingerprintOverride = null
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

// --- Confirming-hit ----------------------------------------------------------

describe('runInstall — confirming-hit (exact add, warm cache, no lock entry)', () => {
  test('confirms via metadata, never downloads, and writes the confirmed entry', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    fixtureForVersion = (v) => (v === '0.1.0' ? seeded.fixture : null)
    writeFacets({})

    const result = await install({ additions: [registryAddition('cowsay@0.1.0')] })
    if (!result.ok) expect.unreachable()

    // Exactly one metadata request (the confirmation), zero downloads.
    expect(resolveRequests).toEqual([{ name: 'cowsay', version: '0.1.0' }])
    expect(downloadCalls).toEqual([])
    // The entry records the resolved exact version and the CONFIRMED integrity.
    expect(readLock().facets.cowsay?.version).toBe('0.1.0')
    expect(readLock().facets.cowsay?.integrity).toBe(seeded.integrity)
    expect(readFacets().cowsay).toBe('0.1.0')
  })

  test('offline confirmation fails closed with CONFIRMATION_UNAVAILABLE and writes nothing', async () => {
    seedRegistrySlot('cowsay', '0.1.0')
    metadataOffline = true
    const facetsBefore = writeFacets({})

    const result = await install({ additions: [registryAddition('cowsay@0.1.0')] })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'CONFIRMATION_UNAVAILABLE') expect.unreachable()
    expect(result.failure.facet).toBe('cowsay')
    expect(result.failure.version).toBe('0.1.0')
    expect(result.failure.error.code).toBe('NETWORK_ERROR')

    // Nothing downloaded; nothing written — manifest byte-unchanged,
    // lockfile and receipt never created.
    expect(downloadCalls).toEqual([])
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('an unusable published fingerprint fails closed with no entry written', async () => {
    // The real wire layer rejects a metadata response missing
    // content_integrity before it ever reaches the chain (unit-tested in
    // resolve-metadata.test.ts). This covers the next layer down: even
    // if an unusable fingerprint reached confirmation, the audited
    // content cannot match it — Check A fails closed.
    seedRegistrySlot('cowsay', '0.1.0')
    fingerprintOverride = ''
    const facetsBefore = writeFacets({})

    const result = await install({ additions: [registryAddition('cowsay@0.1.0')] })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'INTEGRITY_FAILURE') expect.unreachable()
    if (result.failure.failure.kind !== 'facet') expect.unreachable()
    expect(result.failure.failure.check).toBe('A')
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })
})

// --- Locked-hit ---------------------------------------------------------------

describe('runInstall — locked-hit (plain install, warm cache, satisfying lock)', () => {
  test('succeeds fully offline with zero registry requests', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    metadataOffline = true
    writeFacets({ cowsay: '0.1.0' })
    writeLock({ cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity } })

    const result = await install()
    if (!result.ok) expect.unreachable()

    expect(resolveRequests).toEqual([])
    expect(downloadCalls).toEqual([])
    expect(readLock().facets.cowsay?.integrity).toBe(seeded.integrity)
  })
})

// --- Tampered cache ------------------------------------------------------------

describe('runInstall — tampered cache slot (bytes modified, sidecar intact)', () => {
  test('evicts, re-downloads, and succeeds', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    writeFileSync(join(seeded.slotPath, 'skills/planning/SKILL.md'), '# tampered\n')
    fixtureForVersion = (v) => (v === '0.1.0' ? seeded.fixture : null)
    writeFacets({ cowsay: '0.1.0' })
    writeLock({ cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity } })

    const result = await install()
    if (!result.ok) expect.unreachable()

    // The failed self-audit evicted the slot and the chain re-downloaded.
    expect(downloadCalls).toEqual(['0.1.0'])
    expect(readLock().facets.cowsay?.integrity).toBe(seeded.integrity)
    // The slot is repopulated with clean content.
    const slot = cachePath({ kind: 'registry', name: 'cowsay', version: '0.1.0' })
    expect(readFileSync(join(slot, 'skills/planning/SKILL.md'), 'utf8')).toBe('# planning 0.1.0\n')
  })

  test('offline: fails, tampered content is never materialized, slot stays evicted', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    writeFileSync(join(seeded.slotPath, 'skills/planning/SKILL.md'), '# tampered\n')
    metadataOffline = true
    const facetsBefore = writeFacets({ cowsay: '0.1.0' })
    const lockBefore = writeLock({
      cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity },
    })

    const result = await install()
    if (result.ok) expect.unreachable()
    // The retry-as-miss needs metadata for archive resolution; offline
    // that is a download failure (REGISTRY_ERROR), not a confirmation
    // failure — an entry already anchors this facet.
    if (result.failure.code !== 'REGISTRY_ERROR') expect.unreachable()

    // Tampered content never reached an adapter tree, and the slot was evicted.
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(false)
    expect(existsSync(seeded.slotPath)).toBe(false)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })
})

// --- Audited lockfile mismatch ---------------------------------------------------

describe('runInstall — locked-hit audited mismatch (coordinated bytes+sidecar rewrite)', () => {
  test('fails hard with CACHE_INTEGRITY_MISMATCH and never re-downloads', async () => {
    // The slot is internally consistent (audit passes), but its audited
    // integrity contradicts the lockfile — the registry-immutability
    // defense. Deliberately NOT self-healing.
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    const lockedIntegrity = 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    writeFacets({ cowsay: '0.1.0' })
    writeLock({ cowsay: { version: '0.1.0', integrity: lockedIntegrity } })

    const result = await install()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'CACHE_INTEGRITY_MISMATCH') expect.unreachable()
    expect(result.failure.facet).toBe('cowsay')
    expect(result.failure.slotPath).toBe(seeded.slotPath)
    expect(result.failure.cachedIntegrity).toBe(seeded.integrity)
    expect(result.failure.lockedIntegrity).toBe(lockedIntegrity)

    // No network interaction of any kind — the failure is local and hard.
    expect(resolveRequests).toEqual([])
    expect(downloadCalls).toEqual([])
    // The slot is NOT evicted (the content audited clean).
    expect(existsSync(seeded.slotPath)).toBe(true)
  })
})

// --- The structural discriminator ------------------------------------------------

describe('runInstall — the structural discriminator vs a satisfying lock', () => {
  test('add foo@0.* re-resolves to newest-in-range despite a satisfying older lock', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    wildcardResolutions = { '0.*': '0.2.0' }
    const newest = buildFixture(fakeHome, 'cowsay', '0.2.0')
    fixtureForVersion = (v) => (v === '0.2.0' ? newest : null)
    writeFacets({ cowsay: '0.*' })
    writeLock({ cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity } })

    const result = await install({ additions: [registryAddition('cowsay@0.*')] })
    if (!result.ok) expect.unreachable()

    // The addition re-resolved the range; the locked 0.1.0 did not pin it.
    expect(resolveRequests).toEqual([{ name: 'cowsay', version: '0.*' }])
    expect(readLock().facets.cowsay?.version).toBe('0.2.0')
    // Explicit range specifier stays verbatim in the manifest (floats).
    expect(readFacets().cowsay).toBe('0.*')
  })

  test('a bare add re-resolves despite a lock and pins the resolved exact', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    wildcardResolutions = { latest: '0.2.0' }
    const newest = buildFixture(fakeHome, 'cowsay', '0.2.0')
    fixtureForVersion = (v) => (v === '0.2.0' ? newest : null)
    writeFacets({ cowsay: '0.1.0' })
    writeLock({ cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity } })

    const result = await install({ additions: [registryAddition('cowsay')] })
    if (!result.ok) expect.unreachable()

    expect(resolveRequests).toEqual([{ name: 'cowsay', version: 'latest' }])
    expect(readLock().facets.cowsay?.version).toBe('0.2.0')
    // Bare add → pinned to the resolved exact.
    expect(readFacets().cowsay).toBe('0.2.0')
  })

  test('an explicit @latest add re-resolves and stays verbatim in the manifest', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    wildcardResolutions = { latest: '0.2.0' }
    const newest = buildFixture(fakeHome, 'cowsay', '0.2.0')
    fixtureForVersion = (v) => (v === '0.2.0' ? newest : null)
    writeFacets({ cowsay: '0.1.0' })
    writeLock({ cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity } })

    const result = await install({ additions: [registryAddition('cowsay@latest')] })
    if (!result.ok) expect.unreachable()

    expect(resolveRequests).toEqual([{ name: 'cowsay', version: 'latest' }])
    expect(readLock().facets.cowsay?.version).toBe('0.2.0')
    // Explicit @latest → written verbatim; the manifest entry floats.
    expect(readFacets().cowsay).toBe('latest')
  })

  test('an exact re-add of an already-locked version succeeds offline with zero requests', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    metadataOffline = true
    writeFacets({ cowsay: '0.1.0' })
    writeLock({ cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity } })

    const result = await install({ additions: [registryAddition('cowsay@0.1.0')] })
    if (!result.ok) expect.unreachable()

    // The exact addition kept the satisfying entry as its trust anchor:
    // no version resolution, no confirmation, no download.
    expect(resolveRequests).toEqual([])
    expect(downloadCalls).toEqual([])
    expect(readLock().facets.cowsay?.integrity).toBe(seeded.integrity)
  })
})

// --- Frozen mode -------------------------------------------------------------------

describe('runInstall — frozen mode and the chain', () => {
  test('tampered cache under frozen: evict, re-download, verify against locked integrity', async () => {
    const seeded = seedRegistrySlot('cowsay', '0.1.0')
    writeFileSync(join(seeded.slotPath, 'skills/planning/SKILL.md'), '# tampered\n')
    fixtureForVersion = (v) => (v === '0.1.0' ? seeded.fixture : null)
    const facetsBefore = writeFacets({ cowsay: '0.1.0' })
    const lockBefore = writeLock({
      cowsay: { version: '0.1.0', integrity: seeded.integrity, skillIntegrity: seeded.skillIntegrity },
    })

    const result = await install({ frozen: true })
    if (!result.ok) expect.unreachable()

    // Archive resolution is permitted under frozen — the re-download
    // reproduced the locked integrity.
    expect(downloadCalls).toEqual(['0.1.0'])
    // The locked set is never written under frozen.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })
})
