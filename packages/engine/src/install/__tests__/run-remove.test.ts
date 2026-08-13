import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import { CURRENT_LOCKFILE_VERSION, LOCKFILE_VERSION_0_2, type ProjectFacetEntry } from '@agent-facets/protocol'
import { SUPPORTED_ADAPTER_APIS } from '../../adapters/api-compatibility.ts'
import type { StageEvent } from '../types.ts'

/**
 * Tests for the `facet remove` orchestrator (`runRemove`).
 *
 * Each test first seeds project state by running `runAdd` (which installs a
 * facet, writing the manifest, lockfile, and materialized assets) and then
 * exercises `runRemove`. The registry resolve + download path is stubbed via
 * `mock.module` exactly as in run-add.test.ts so no live registry is needed;
 * everything downstream (build, content-hash, materialize, drift-removal,
 * lockfile) runs for real.
 */

// --- Registry mock state (mutated per-test before calling runAdd) ---------

let registryFixtureDir: string | null = null
let registryResolvedVersion = '0.1.1'

/** Build the fixture's genuine build manifest — the same artifact a real
 *  registry would serve in the outer tar. The chain's hash checks (B/C,
 *  the post-download recompute) run for real against it. */
async function manifestFor(fixtureDir: string) {
  const { runBuildPipeline } = await import('../../build/pipeline.ts')
  const built = await runBuildPipeline(fixtureDir, [])
  if (!built.ok) throw new Error('test bug: fixture failed to build')
  return JSON.parse(built.manifestJson) as import('@agent-facets/protocol').CurrentBuildManifest
}

mock.module('../../registry/resolve-metadata.ts', () => ({
  resolveRegistryMetadataBatch: async (specs: ReadonlyArray<{ name: string }>) => {
    const contentFingerprint =
      registryFixtureDir === null ? 'sha256:stub' : (await manifestFor(registryFixtureDir)).integrity
    return {
      ok: true,
      value: specs.map((s) => ({
        name: s.name,
        version: registryResolvedVersion,
        transportHash: 'sha256:stub',
        contentFingerprint,
      })),
    }
  },
}))

mock.module('../../registry/download.ts', () => ({
  downloadAndExtractFacet: async (_meta: { name: string }, dest: string) => {
    if (registryFixtureDir === null) {
      return { ok: false, error: { code: 'NETWORK_ERROR', cause: 'no fixture set', attempts: 1 } }
    }
    cpSync(registryFixtureDir, dest, { recursive: true })
    const manifest = await manifestFor(registryFixtureDir)
    return { ok: true, value: { integrity: manifest.integrity, fileHashes: manifest.files } }
  },
}))

// Imported AFTER the mocks are registered so run-install picks up the stubs.
const { runAdd } = await import('../run-add.ts')
const { runRemove, prepareRemove } = await import('../run-remove.ts')
const { parseFacetSource } = await import('../../sources/facet/parse-source.ts')
const { loadInstalledAdapters } = await import('../../adapters/loader.ts')

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined
let adaptersDir: string

/** Build a facet fixture directory (a `facet.json` + one skill). */
function buildFixture(parent: string, name: string, version: string): string {
  const repo = realpathSync(mkdtempSync(join(parent, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({ name, version, skills: { [name]: { description: `${name} skill` } } }),
  )
  mkdirSync(join(repo, `skills/${name}`), { recursive: true })
  writeFileSync(join(repo, `skills/${name}/SKILL.md`), `# ${name} ${version}\n`)
  return repo
}

function installFakeAdapter(baseDir: string, name: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  const sdk = require.resolve('@agent-facets/adapter')
  writeFileSync(
    join(dir, 'adapter.js'),
    `
import { planSingleFileInstall, planSingleFileRemoval } from '${sdk}'
import { join } from 'node:path'
function base(req) { return join(req.projectRoot, '.${name}') }
function file(req) { return join(base(req), req.assetType + 's', req.name + '.md') }
export default {
  name: '${name}',
  apiVersion: '${ADAPTER_API_VERSION}',
  mcpServers: false,
  buildAssetMetadata(data) { return { ok: true, data: data || {} } },
  assets: {
    async planInstall(req) {
      return planSingleFileInstall({ file: file(req), boundary: base(req) }, req.content, req.metadata)
    },
    async planRemoval(req) {
      return planSingleFileRemoval({ file: file(req), boundary: base(req) })
    },
  },
}
`,
  )
}

/**
 * A facets.json entry is `string | { source, materialization }`. Typing
 * these helpers as a flat string map made the expanded form unrepresentable,
 * so a suite using them could not cover aliasing even if it wanted to.
 */
function readFacets(): Record<string, ProjectFacetEntry> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets
}

function readLockfileFacets(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).facets
}

function assetPath(adapter: string, facet: string): string {
  // Mirrors the fake adapter's path(): .<adapter>/skills/<facet>.md
  return join(projectRoot, `.${adapter}`, 'skills', `${facet}.md`)
}

async function installFacet(name: string, version: string): Promise<void> {
  registryResolvedVersion = version
  registryFixtureDir = buildFixture(fakeHome, name, version)
  const parsed = parseFacetSource(`${name}@${version}`)
  if (!parsed.ok) throw new Error(`test bug: unparseable specifier ${name}@${version}`)
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters.filter((a) => a.assets !== false)
  const result = await runAdd({
    projectRoot,
    sources: [{ specifier: `${name}@${version}`, source: parsed.value }],
    adapters,
  })
  if (!result.ok) throw new Error(`test bug: failed to seed facet ${name}`)
}

async function remove(names: string[], onStage?: (event: StageEvent) => void) {
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters.filter((a) => a.assets !== false)
  return runRemove({ projectRoot, names, adapters, ...(onStage ? { onStage } : {}) })
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-runremove-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
  installFakeAdapter(adaptersDir, 'test-adapter')
  registryFixtureDir = null
  registryResolvedVersion = '0.1.1'
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

describe('runRemove — single-facet removal', () => {
  test('removes the facet from manifest, lockfile, and adapter', async () => {
    await installFacet('cowsay', '0.1.1')
    expect(readFacets().cowsay).toBe('0.1.1')
    expect(readLockfileFacets().cowsay).toBeDefined()
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    expect(readFacets().cowsay).toBeUndefined()
    expect(readLockfileFacets().cowsay).toBeUndefined()
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(false)
    // The removed facet is surfaced as a `removed` outcome.
    expect(result.install.perFacet.some((o) => o.kind === 'removed' && o.name === 'cowsay')).toBe(true)
  })
})

describe('runRemove — multi-facet removal', () => {
  test('removes all named facets in one operation', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('fortune', '0.2.0')

    const result = await remove(['cowsay', 'fortune'])
    expect(result.ok).toBe(true)

    expect(readFacets().cowsay).toBeUndefined()
    expect(readFacets().fortune).toBeUndefined()
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(false)
    expect(existsSync(assetPath('test-adapter', 'fortune'))).toBe(false)
  })

  test('leaves other facets intact', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('fortune', '0.2.0')

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(true)

    expect(readFacets().cowsay).toBeUndefined()
    expect(readFacets().fortune).toBe('0.2.0')
    expect(readLockfileFacets().fortune).toBeDefined()
    expect(existsSync(assetPath('test-adapter', 'fortune'))).toBe(true)
  })

  test('absent names are silently ignored — only declared facets are removed', async () => {
    await installFacet('cowsay', '0.1.1')

    const result = await remove(['cowsay', 'does-not-exist'])
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    // cowsay was removed; does-not-exist was silently ignored.
    expect(Object.keys(readFacets())).not.toContain('cowsay')
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(false)
  })
})

// The published contract says removal needs neither cache nor network. That
// only ever held for the facet being REMOVED: routing removal through the
// normal pipeline re-resolved every remaining facet, so an unrelated facet being
// uncached and unreachable failed the whole operation.
describe('runRemove — a remaining facet is unavailable', () => {
  /** Empty the content cache and make every registry request fail. */
  function goOffline(): void {
    rmSync(join(fakeHome, '.facet/cache'), { recursive: true, force: true })
    registryFixtureDir = null
  }

  function readLock(): { lockfileVersion: number; facets: Record<string, Record<string, unknown>> } {
    return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
  }

  /** Rewrite the lockfile as `0.2` — no dispositions — in place. */
  function downgradeLockfileTo02(): void {
    const lock = readLock()
    lock.lockfileVersion = LOCKFILE_VERSION_0_2
    for (const facet of Object.values(lock.facets)) {
      for (const asset of facet.assets as Array<Record<string, unknown>>) delete asset.materialization
    }
    writeFileSync(join(projectRoot, 'facets.lock'), JSON.stringify(lock, null, 2))
  }

  test.each([
    ['0.3', () => {}],
    ['0.2', downgradeLockfileTo02],
  ])('removes one facet offline while a %s-locked remaining facet is unavailable', async (_version, prepare) => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')
    const remainingAsset = assetPath('test-adapter', 'planner')
    const remainingBefore = readFileSync(remainingAsset, 'utf8')
    prepare()
    const lockedRemaining = readLock().facets.planner
    goOffline()

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()

    // The removal completed without the remaining content being available.
    expect(readFacets().cowsay).toBeUndefined()
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(false)

    // The remaining facet is untouched on disk and carried forward verbatim.
    expect(readFileSync(remainingAsset, 'utf8')).toBe(remainingBefore)
    const migrated = readLock()
    expect(migrated.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
    const remaining = migrated.facets.planner
    if (remaining === undefined || lockedRemaining === undefined) expect.unreachable()
    expect(remaining.source).toEqual(lockedRemaining.source)
    expect(remaining.version).toEqual(lockedRemaining.version)
    expect(remaining.integrity).toEqual(lockedRemaining.integrity)
    const assetsOf = (entry: Record<string, unknown>) => entry.assets as Array<Record<string, unknown>>
    expect(assetsOf(remaining).map((a) => a.files)).toEqual(assetsOf(lockedRemaining).map((a) => a.files))
    // A `0.2` entry refines to the only disposition it could have meant.
    for (const asset of assetsOf(remaining)) expect(asset.materialization).toEqual({ kind: 'authored' })
  })

  // The state a concurrent removal leaves behind. Routing on how many
  // requested names still exist meant this request was not "removal-only" at
  // all, so it fell through to the resolve path and tried to re-fetch every
  // unrelated facet in the project — to do nothing.
  test('an all-absent removal stays offline', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')
    const before = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    const remainingBefore = readFileSync(assetPath('test-adapter', 'planner'), 'utf8')
    goOffline()

    const result = await remove(['never-installed'])

    expect(result.ok).toBe(true)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before)
    expect(readFileSync(assetPath('test-adapter', 'planner'), 'utf8')).toBe(remainingBefore)
    expect(Object.keys(readLock().facets).sort()).toEqual(['cowsay', 'planner'])
  })

  test('carries a remaining unrecognized field through the offline removal', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')
    const lock = readLock()
    const planner = lock.facets.planner
    if (planner === undefined) expect.unreachable()
    planner.futureField = 'keep me'
    writeFileSync(join(projectRoot, 'facets.lock'), JSON.stringify(lock, null, 2))
    goOffline()

    expect((await remove(['cowsay'])).ok).toBe(true)

    expect(readLock().facets.planner?.futureField).toBe('keep me')
  })

  // Removal must not silently become an install. When a remaining facet declares
  // intent the lockfile does not record, honoring it means WRITING assets, so
  // the ordinary pipeline has to run — and offline, that fails rather than
  // pretending the alias was applied.
  test('a remaining facet with unrecorded alias intent does not refine', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    manifest.facets.planner = {
      source: manifest.facets.planner,
      materialization: { skills: { planner: { kind: 'aliased', as: 'vendor-planner' } } },
    }
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify(manifest, null, 2))
    goOffline()

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    // It failed trying to RESOLVE the remaining facet, which is the honest outcome:
    // the alias cannot be materialized without the facet's content.
    expect(existsSync(assetPath('test-adapter', 'planner'))).toBe(true)
  })

  // Same rule from the other side: the manifest and lockfile can agree with
  // each other and still disagree with THIS machine, because a pull updates
  // both without touching a single materialized file.
  test('a remaining facet the receipt does not witness does not refine', async () => {
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')

    // A teammate's alias, pulled into both shared files. This machine still
    // has `planner` on disk under its authored name.
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    manifest.facets.planner = {
      source: manifest.facets.planner,
      materialization: { skills: { planner: { kind: 'aliased', as: 'vendor-planner' } } },
    }
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify(manifest, null, 2))
    const lock = readLock()
    for (const asset of (lock.facets.planner?.assets ?? []) as Array<Record<string, unknown>>) {
      asset.materialization = { kind: 'aliased', as: 'vendor-planner' }
    }
    writeFileSync(join(projectRoot, 'facets.lock'), JSON.stringify(lock, null, 2))
    goOffline()

    const result = await remove(['cowsay'])

    // Refining would have committed a receipt claiming `vendor-planner` while
    // the authored bundle sat on disk, owned by nothing.
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    expect(existsSync(assetPath('test-adapter', 'planner'))).toBe(true)
    expect(existsSync(assetPath('test-adapter', 'vendor-planner'))).toBe(false)
  })

  test.each([
    ['corrupt', 'not json{'],
    ['path-mismatch', JSON.stringify({ version: 0.3, path: '/some/other/project', facets: {} })],
  ])('a pulled alias is not refined when the receipt is %s', async (_reason, body) => {
    const { receiptPath } = await import('../receipt.ts')
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')

    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    manifest.facets.planner = {
      source: manifest.facets.planner,
      materialization: { skills: { planner: { kind: 'aliased', as: 'vendor-planner' } } },
    }
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify(manifest, null, 2))
    const lock = readLock()
    for (const asset of (lock.facets.planner?.assets ?? []) as Array<Record<string, unknown>>) {
      asset.materialization = { kind: 'aliased', as: 'vendor-planner' }
    }
    writeFileSync(join(projectRoot, 'facets.lock'), JSON.stringify(lock, null, 2))
    writeFileSync(receiptPath(projectRoot), body)
    goOffline()

    const result = await remove(['cowsay'])

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    expect(existsSync(assetPath('test-adapter', 'planner'))).toBe(true)
    expect(existsSync(assetPath('test-adapter', 'vendor-planner'))).toBe(false)
  })

  // The offline guarantee is a property of TRACKED state, not of removal. With
  // no receipt, nothing on this machine is witnessed: the facets that stay
  // must be materialized before their identities can be claimed, and that
  // needs resolution. Deleting on lockfile evidence alone is the alternative,
  // and it destroys files this machine cannot prove it wrote.
  test('an absent receipt cannot remove offline, and deletes nothing', async () => {
    const { receiptPath } = await import('../receipt.ts')
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')
    const remainingAsset = assetPath('test-adapter', 'planner')
    const remainingBefore = readFileSync(remainingAsset, 'utf8')
    rmSync(receiptPath(projectRoot), { force: true })
    goOffline()

    const events: StageEvent[] = []
    const result = await remove(['cowsay'], (event) => events.push(event))

    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    // Untracked assets are left exactly where they are — including the one
    // belonging to the facet the user asked to remove.
    expect(readFileSync(remainingAsset, 'utf8')).toBe(remainingBefore)
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)
    // The failure names `planner` — a facet the user is KEEPING. Why this run
    // was resolving it at all has to travel with the failure, or the error
    // reads as unrelated to the removal that caused it.
    expect(events).toContainEqual({ kind: 'removal-resolution-required', reason: 'receipt-unwitnessable' })
  })

  // The other half of the same rule: needing resolution is not the same as
  // failing. With content still reachable, the removal runs the ordinary
  // pipeline, materializes the remaining desired state, and claims only that.
  test('an absent receipt still removes when content is reachable', async () => {
    const { receiptPath } = await import('../receipt.ts')
    await installFacet('cowsay', '0.1.1')
    await installFacet('planner', '0.2.0')
    rmSync(receiptPath(projectRoot), { force: true })

    const result = await remove(['cowsay'])

    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    // The declaration is gone from both shared files...
    expect(readFacets().cowsay).toBeUndefined()
    expect(readLockfileFacets().cowsay).toBeUndefined()
    // ...but its asset was untracked, so it stays on disk and is reported as
    // such rather than as a deletion that never happened.
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)
    expect(result.install.perFacet).toContainEqual({
      kind: 'removed-untracked',
      name: 'cowsay',
      oldVersion: '0.1.1',
    })
    expect(result.install.summary.textAssets.removed).toBe(0)
    // The facet that stays was rewritten, and is tracked from now on.
    expect(existsSync(assetPath('test-adapter', 'planner'))).toBe(true)
    const receipt = JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8'))
    expect(Object.keys(receipt.facets)).toEqual(['planner'])
  })
})

describe('runRemove — undeclared facet', () => {
  test('removing only undeclared facets succeeds as a no-op', async () => {
    await installFacet('cowsay', '0.1.1')
    const beforeFacets = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    const result = await remove(['ghost'])
    expect(result.ok).toBe(true)

    // Nothing was removed — cowsay is still installed.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(beforeFacets)
  })

  test('fails with manifest-read when no facets.json exists', async () => {
    // Fresh project root, no facets.json written.
    const result = await remove(['anything'])
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    if (result.phase !== 'prepare') expect.unreachable()
    expect(result.failure.reason).toBe('manifest-read')
  })
})

describe('runRemove — last facet', () => {
  test('removing the only facet leaves an empty manifest and valid empty lockfile', async () => {
    await installFacet('cowsay', '0.1.1')

    const result = await remove(['cowsay'])
    expect(result.ok).toBe(true)

    expect(Object.keys(readFacets())).toHaveLength(0)
    expect(Object.keys(readLockfileFacets())).toHaveLength(0)
    // Lockfile is still structurally valid: a normal install always writes
    // the current schema, whatever it was read at.
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lock.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
  })
})

describe('prepareRemove — read-only validation', () => {
  test('an undeclared name passes validation without mutating disk', async () => {
    await installFacet('cowsay', '0.1.1')
    const beforeFacets = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    const beforeLock = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')

    const result = prepareRemove({ projectRoot, names: ['ghost'] })

    // Whether `ghost` is declared is not this phase's question — the commit
    // answers it under the lock. All this reports is that the manifest reads.
    expect(result.ok).toBe(true)
    // Pure validation: nothing on disk changed.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(beforeFacets)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(beforeLock)
  })

  test('a readable manifest carries no project state forward', async () => {
    await installFacet('cowsay', '0.1.1')

    const result = prepareRemove({ projectRoot, names: ['cowsay', 'ghost', 'phantom'] })

    // Success is exactly `{ ok: true }`. A caller cannot decide an outcome
    // from a pre-lock snapshot it was never handed.
    expect(result).toEqual({ ok: true })
  })

  test('returns manifest-read when no facets.json exists', () => {
    // Fresh project root, no facets.json written.
    const result = prepareRemove({ projectRoot, names: ['anything'] })
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('manifest-read')
  })
})

describe('runRemove — adapter compatibility is not bypassed', () => {
  /** Structurally valid adapter with an unsupported API; methods throw loud. */
  function incompatibleAdapter(name: string, apiVersion: unknown): Adapter {
    return {
      name,
      apiVersion,
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
  }

  test('removal with an incompatible selected adapter fails before deleting anything', async () => {
    await installFacet('cowsay', '0.1.1')
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)
    const { receiptPath } = await import('../receipt.ts')
    const before = {
      facets: readFileSync(join(projectRoot, 'facets.json'), 'utf8'),
      lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'),
      receipt: readFileSync(receiptPath(projectRoot), 'utf8'),
    }

    const result = await runRemove({
      projectRoot,
      names: ['cowsay'],
      adapters: [incompatibleAdapter('future-adapter', '9.9')],
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    if (result.install.failure.code !== 'ADAPTER_INCOMPATIBLE') expect.unreachable()
    expect(result.install.failure.failures).toEqual([
      { kind: 'api-unsupported', adapter: 'future-adapter', found: '9.9', supported: SUPPORTED_ADAPTER_APIS },
    ])
    expect(result.install.rollback.kind).toBe('not-needed')

    // Nothing was deleted: the materialized asset survives and every
    // project file is byte-for-byte unchanged.
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before.facets)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(before.lock)
    expect(readFileSync(receiptPath(projectRoot), 'utf8')).toBe(before.receipt)
  })

  test('a superseded positional 0.0 adapter blocks removal before deleting anything', async () => {
    // The cutover applies to removal too: a 0.0 adapter is unsupported by
    // a 0.1-only CLI, so removal fails before any asset deletion or write.
    await installFacet('cowsay', '0.1.1')
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)
    const { receiptPath } = await import('../receipt.ts')
    const before = {
      facets: readFileSync(join(projectRoot, 'facets.json'), 'utf8'),
      lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'),
      receipt: readFileSync(receiptPath(projectRoot), 'utf8'),
    }

    const result = await runRemove({
      projectRoot,
      names: ['cowsay'],
      adapters: [incompatibleAdapter('legacy-positional', '0.0')],
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    if (result.install.failure.code !== 'ADAPTER_INCOMPATIBLE') expect.unreachable()
    expect(result.install.failure.failures).toEqual([
      { kind: 'api-unsupported', adapter: 'legacy-positional', found: '0.0', supported: SUPPORTED_ADAPTER_APIS },
    ])

    // Nothing deleted; every project file byte-for-byte unchanged.
    expect(existsSync(assetPath('test-adapter', 'cowsay'))).toBe(true)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before.facets)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(before.lock)
    expect(readFileSync(receiptPath(projectRoot), 'utf8')).toBe(before.receipt)
  })
})

describe('runRemove — install-failure leaves manifest unchanged', () => {
  test('facets.json, facets.lock, and the receipt are untouched when install fails', async () => {
    await installFacet('cowsay', '0.1.1')
    const { receiptPath } = await import('../receipt.ts')
    const before = {
      facets: readFileSync(join(projectRoot, 'facets.json'), 'utf8'),
      lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'),
      receipt: readFileSync(receiptPath(projectRoot), 'utf8'),
    }

    // Force a runInstall failure: hold the install lock so runRemove's
    // runInstall call fails with LOCK_HELD. With the delta-based flow,
    // the manifest is never written ahead — it stays untouched on failure.
    const { acquireInstallLock } = await import('../lockfile-guard.ts')
    const lock = acquireInstallLock(projectRoot)
    if (!lock.ok) expect.unreachable()

    try {
      const result = await remove(['cowsay'])
      expect(result.ok).toBe(false)
      if (result.ok) expect.unreachable()
      expect(result.phase).toBe('install')
    } finally {
      await lock.lock.release()
    }

    // All three project files unchanged: the delta-based flow never
    // writes ahead of install — they are only written together on success.
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before.facets)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(before.lock)
    expect(readFileSync(receiptPath(projectRoot), 'utf8')).toBe(before.receipt)
  })
})
