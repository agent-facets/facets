import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import type { CurrentBuildManifest } from '@agent-facets/protocol'
import { CURRENT_RECEIPT_VERSION, type Receipt } from '../receipt.ts'
import type { Addition, StageEvent } from '../types.ts'

/**
 * Spec-scenario coverage for the machine-local receipt and the
 * transactional tri-write through `runInstall`: orphan-on-pull cleanup
 * (including under frozen), per-entry escape handling (W2), offline
 * removal via the receipt's stored asset list, and byte-exact tri-file
 * restore on a mid-trio write failure (W1).
 *
 * Same harness contract as run-install.chain.test.ts: genuine hashes,
 * stubbed network, request recording.
 */

// --- Registry mock state -----------------------------------------------------

type FixtureForVersion = (version: string) => string | null
let fixtureForVersion: FixtureForVersion = () => null
let resolveRequests: Array<{ name: string; version: string }> = []
let metadataOffline = false

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
    const requested =
      spec.version.kind === 'exact'
        ? `${spec.version.major}.${spec.version.minor}.${spec.version.patch}`
        : spec.version.kind
    resolveRequests.push({ name: spec.name, version: requested })
    if (metadataOffline) {
      return { ok: false, error: { code: 'NETWORK_ERROR', cause: 'simulated offline', attempts: 3 } }
    }
    const fixture = fixtureForVersion(requested)
    const contentFingerprint = fixture === null ? 'sha256:stub' : (await manifestFor(fixture)).integrity
    return {
      ok: true,
      value: [{ name: spec.name, version: requested, transportHash: 'sha256:stub', contentFingerprint }],
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
    return { ok: true, value: { integrity: manifest.integrity, fileHashes: manifest.files } }
  },
}))

const { runInstall } = await import('../run-install.ts')
const { loadInstalledAdapters } = await import('../../adapters/loader.ts')
const { parseFacetSource } = await import('../../sources/facet/parse-source.ts')
const { receiptPath, writeReceipt } = await import('../receipt.ts')

// --- Project / fixture helpers -------------------------------------------------

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined

function buildFixture(parent: string, name: string, version: string, skill = 'planning'): string {
  const repo = realpathSync(mkdtempSync(join(parent, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({ name, version, skills: { [skill]: { description: `${skill} skill` } } }),
  )
  mkdirSync(join(repo, `skills/${skill}`), { recursive: true })
  writeFileSync(join(repo, `skills/${skill}/SKILL.md`), `# ${skill} ${version}\n`)
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
  mcpServers: false,
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

function registryAddition(specifier: string): Addition {
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok || parsed.value.kind !== 'registry') throw new Error('test bug: not a registry specifier')
  return { facetName: parsed.value.name, specifier, source: parsed.value }
}

async function install(
  opts: {
    additions?: Addition[]
    removals?: { facetName: string }[]
    frozen?: boolean
    onStage?: (event: StageEvent) => void
  } = {},
) {
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters
  return runInstall({
    projectRoot,
    adapters: adapters.filter((a) => a.supportsInstall === true),
    delta:
      opts.additions || opts.removals ? { additions: opts.additions ?? [], removals: opts.removals ?? [] } : undefined,
    frozenLockfile: opts.frozen,
    onStage: opts.onStage,
  })
}

/** Install `cowsay@0.1.0` from a fixture so all three project files exist. */
async function seedInstalledProject(): Promise<void> {
  const fixture = buildFixture(fakeHome, 'cowsay', '0.1.0')
  fixtureForVersion = (v) => (v === '0.1.0' ? fixture : null)
  writeFileSync(join(projectRoot, 'facets.json'), `${JSON.stringify({ facets: {} }, null, 2)}\n`)
  const result = await install({ additions: [registryAddition('cowsay@0.1.0')] })
  if (!result.ok) throw new Error('test bug: seeding install failed')
}

const triFiles = () => [join(projectRoot, 'facets.json'), join(projectRoot, 'facets.lock'), receiptPath(projectRoot)]

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-receipt-')))
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
  metadataOffline = false
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

// --- Orphan-on-pull under frozen ----------------------------------------------

describe('runInstall — frozen orphan-on-pull cleanup', () => {
  test('deletes orphaned assets via the receipt and rewrites the receipt only', async () => {
    await seedInstalledProject()
    // Simulate the pull: a `ghost` facet was dropped from facets.json AND
    // facets.lock by version control, but the machine-local receipt still
    // records it as materialized, and its asset is still on disk.
    const receiptFile = receiptPath(projectRoot)
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8')) as Receipt
    receipt.facets.ghost = {
      version: '1.0.0',
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'ghostly',
          materialization: { kind: 'authored' },
          files: ['skills/ghostly/SKILL.md'],
        },
      ],
    }
    writeReceipt(projectRoot, receipt)
    mkdirSync(join(projectRoot, '.test-adapter/skills'), { recursive: true })
    writeFileSync(join(projectRoot, '.test-adapter/skills/ghostly.md'), '# stranded\n')

    metadataOffline = true // warm cache → frozen reproduction is offline
    const facetsBefore = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')

    const result = await install({ frozen: true })
    if (!result.ok) expect.unreachable()

    // The orphan was cleaned up offline using the receipt's asset list.
    const removed = result.perFacet.find((o) => o.kind === 'removed' && o.name === 'ghost')
    expect(removed).toBeDefined()
    expect(existsSync(join(projectRoot, '.test-adapter/skills/ghostly.md'))).toBe(false)
    // The receipt was rewritten without the ghost; the locked set was
    // never written.
    const after = JSON.parse(readFileSync(receiptFile, 'utf8')) as Receipt
    expect(after.facets.ghost).toBeUndefined()
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(facetsBefore)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })

  // 9.5: the frozen consistency gate completes before receipt-driven cleanup.
  // A lockfile ORPHAN (pinned in the lockfile, absent from facets.json) is
  // surfaced as drift and rejected BEFORE any materialized asset is deleted.
  test('a frozen lockfile orphan fails before cleanup deletes anything', async () => {
    await seedInstalledProject() // cowsay in all three files, asset on disk

    // Simulate an orphan: drop cowsay from facets.json only. The lockfile
    // still pins it — a frozen install must reject this as LOCKFILE_DRIFT
    // (reason 'orphaned') before the drift-removal loop runs.
    writeFileSync(join(projectRoot, 'facets.json'), `${JSON.stringify({ facets: {} }, null, 2)}\n`)
    const assetPath = join(projectRoot, '.test-adapter/skills/planning.md')
    expect(existsSync(assetPath)).toBe(true)
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    const receiptFile = receiptPath(projectRoot)
    const receiptBefore = readFileSync(receiptFile, 'utf8')

    metadataOffline = true
    const result = await install({ frozen: true })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    expect(result.failure.facets.some((f) => f.name === 'cowsay' && f.reason === 'orphaned')).toBe(true)
    // No cleanup ran: the materialized asset and both files are untouched.
    expect(existsSync(assetPath)).toBe(true)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
    expect(readFileSync(receiptFile, 'utf8')).toBe(receiptBefore)
    expect(result.rollback.kind).toBe('not-needed')
  })
})

// --- W2: per-entry escape handling ----------------------------------------------

describe('runInstall — receipt escape entries (W2)', () => {
  test('reports the invalid entry via stage event and still processes valid entries', async () => {
    // A receipt recording a facet the project no longer wants, with one
    // crafted escape asset alongside a valid one. The escape is reported
    // and skipped; the valid asset is still cleaned up.
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectRoot),
      facets: {
        ghost: {
          version: '1.0.0',
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: '../escape',
              materialization: { kind: 'authored' },
              files: ['skills/escape/SKILL.md'],
            },
            {
              scope: 'project',
              type: 'skill',
              name: 'ghostly',
              materialization: { kind: 'authored' },
              files: ['skills/ghostly/SKILL.md'],
            },
          ],
        },
      },
    }
    writeReceipt(projectRoot, receipt)
    mkdirSync(join(projectRoot, '.test-adapter/skills'), { recursive: true })
    writeFileSync(join(projectRoot, '.test-adapter/skills/ghostly.md'), '# stranded\n')
    writeFileSync(join(projectRoot, 'facets.json'), `${JSON.stringify({ facets: {} }, null, 2)}\n`)

    const events: StageEvent[] = []
    const result = await install({ onStage: (e) => events.push(e) })
    if (!result.ok) expect.unreachable()

    // The invalid entry was reported, never acted on.
    const invalid = events.find((e) => e.kind === 'receipt-invalid-asset')
    expect(invalid).toEqual({
      kind: 'receipt-invalid-asset',
      facet: 'ghost',
      asset: '../escape',
      reason: expect.stringContaining('segments'),
    })
    // The valid sibling entry was still processed (drift removal).
    expect(existsSync(join(projectRoot, '.test-adapter/skills/ghostly.md'))).toBe(false)
    const removed = result.perFacet.find((o) => o.kind === 'removed' && o.name === 'ghost')
    expect(removed).toBeDefined()
  })
})

// --- Offline removal ----------------------------------------------------------------

describe('runInstall — offline removal via the receipt asset list', () => {
  test('removes a facet with no cache content and an unreachable registry', async () => {
    await seedInstalledProject()
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)

    // Burn the bridges: empty cache, unreachable registry, no fixtures.
    rmSync(join(fakeHome, '.facet/cache'), { recursive: true, force: true })
    metadataOffline = true
    fixtureForVersion = () => null
    resolveRequests = []

    const result = await install({ removals: [{ facetName: 'cowsay' }] })
    if (!result.ok) expect.unreachable()

    // The removal needed neither cache nor network: the receipt's stored
    // asset list drove the deletion.
    expect(resolveRequests).toEqual([])
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(false)
    expect(JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).facets.cowsay).toBeUndefined()
    expect(JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets.cowsay).toBeUndefined()
  })
})

// --- W1: transactional tri-write ------------------------------------------------------

describe('runInstall — tri-write failure restores all three files (W1)', () => {
  test('a mid-trio lockfile write failure restores manifest, lockfile, and receipt byte-for-byte', async () => {
    await seedInstalledProject()
    const [facetsFile, lockFile, receiptFile] = triFiles()
    if (facetsFile === undefined || lockFile === undefined || receiptFile === undefined) expect.unreachable()
    const before = {
      facets: readFileSync(facetsFile, 'utf8'),
      lock: readFileSync(lockFile, 'utf8'),
      receipt: readFileSync(receiptFile, 'utf8'),
    }

    // Sabotage the SECOND write of the trio: `facets.lock.tmp` as a
    // directory makes the atomic lockfile write throw EISDIR after
    // facets.json has already been written.
    mkdirSync(join(projectRoot, 'facets.lock.tmp'), { recursive: true })

    const hello = buildFixture(fakeHome, 'hello', '0.1.0', 'greeting')
    fixtureForVersion = (v) => (v === '0.1.0' ? hello : null)
    const result = await install({ additions: [registryAddition('hello@0.1.0')] })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('LOCKFILE_WRITE_FAILED')
    expect(result.rollback.kind).toBe('succeeded')

    // All three files restored byte-for-byte — including the manifest,
    // which had already been written when the lockfile write failed.
    expect(readFileSync(facetsFile, 'utf8')).toBe(before.facets)
    expect(readFileSync(lockFile, 'utf8')).toBe(before.lock)
    expect(readFileSync(receiptFile, 'utf8')).toBe(before.receipt)
    // The new facet's materialized asset was rolled back; the existing
    // facet's asset is untouched.
    expect(existsSync(join(projectRoot, '.test-adapter/skills/greeting.md'))).toBe(false)
    expect(existsSync(join(projectRoot, '.test-adapter/skills/planning.md'))).toBe(true)
    expect(JSON.parse(readFileSync(facetsFile, 'utf8')).facets.hello).toBeUndefined()
  })
})
