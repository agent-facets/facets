import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import type { ProjectFacetEntry } from '@agent-facets/protocol'

/**
 * Tests for the `facet add` orchestrator (`runAdd`).
 *
 * The registry resolve + download path is stubbed via `mock.module` so the
 * test exercises `runAdd`'s manifest transaction (preserve / heal / pin and
 * the per-source value rule) without a live registry. The stubbed
 * `downloadAndExtractFacet` copies a local fixture into the staging dir it
 * is handed; everything downstream (build, content-hash, materialize, lock-
 * file) runs for real, so `lockfile.facets[name].version` is the fixture's
 * own version. Production download verification (`download.ts`) is covered
 * by its own tests and is intentionally bypassed here.
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

/**
 * A facets.json entry is `string | { source, materialization }`. Typing
 * these helpers as a flat string map made the expanded form unrepresentable,
 * so a suite using them could not cover aliasing even if it wanted to.
 */
function readFacets(): Record<string, ProjectFacetEntry> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets
}

function writeFacets(facets: Record<string, ProjectFacetEntry>): string {
  const bytes = `${JSON.stringify({ facets }, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.json'), bytes)
  return bytes
}

/** Run `runAdd` for a single specifier with the standard wiring. */
async function add(specifier: string) {
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok) throw new Error(`test bug: unparseable specifier ${specifier}`)
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  const adapters = loadResult.adapters
  return runAdd({
    projectRoot,
    sources: [{ specifier, source: parsed.value }],
    adapters: adapters.filter((a) => a.supportsInstall === true),
  })
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-runadd-')))
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

describe('runAdd — registry manifest-value rule', () => {
  test('bare name pins the resolved exact version', async () => {
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '0.1.1')
    const result = await add('cowsay')
    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('0.1.1')
  })

  test('explicit @latest is written verbatim and floats (only a BARE add pins)', async () => {
    // The manifest-write policy (diagrams/committing.md): a bare add is
    // pinned to the resolved exact; an explicit `@latest` is written
    // verbatim so the manifest entry keeps floating. Both re-resolve at
    // add time; only the recorded manifest value differs.
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '0.1.1')
    const result = await add('cowsay@latest')
    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('latest')
  })

  test('explicit exact version is recorded as written', async () => {
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '0.1.1')
    const result = await add('cowsay@0.1.1')
    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('0.1.1')
  })

  test('major wildcard is preserved in the manifest as written', async () => {
    registryResolvedVersion = '1.4.2'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '1.4.2')
    const result = await add('cowsay@1.*')
    expect(result.ok).toBe(true)
    // Wildcard preserved in manifest; lockfile carries the exact version.
    expect(readFacets().cowsay).toBe('1.*')
  })

  test('minor wildcard is preserved in the manifest as written', async () => {
    registryResolvedVersion = '1.2.9'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '1.2.9')
    const result = await add('cowsay@1.2.*')
    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('1.2.*')
  })

  test('bare wildcard is preserved in the manifest as written', async () => {
    registryResolvedVersion = '2.0.0'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '2.0.0')
    const result = await add('cowsay@*')
    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('*')
  })

  test('never records the facet name in the version position', async () => {
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '0.1.1')
    await add('cowsay')
    expect(readFacets().cowsay).not.toBe('cowsay')
  })

  test('scoped bare name pins the resolved exact version under the scoped key', async () => {
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, '@julian/cowsay', '0.1.1')
    const result = await add('@julian/cowsay')
    expect(result.ok).toBe(true)
    expect(readFacets()['@julian/cowsay']).toBe('0.1.1')
  })

  test('scoped explicit @latest is written verbatim and floats', async () => {
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, '@julian/cowsay', '0.1.1')
    const result = await add('@julian/cowsay@latest')
    expect(result.ok).toBe(true)
    expect(readFacets()['@julian/cowsay']).toBe('latest')
  })

  test('scoped explicit exact version is recorded as written', async () => {
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, '@julian/cowsay', '0.1.1')
    const result = await add('@julian/cowsay@0.1.1')
    expect(result.ok).toBe(true)
    expect(readFacets()['@julian/cowsay']).toBe('0.1.1')
  })
})

describe('runAdd — git/local manifest-value rule', () => {
  test('local source records the full specifier', async () => {
    const fixture = buildFixture(projectRoot, 'viper-plans', '0.1.0')
    const rel = `./${fixture.split('/').pop()}`
    const result = await add(rel)
    expect(result.ok).toBe(true)
    expect(readFacets()['viper-plans']).toBe(rel)
  })
})

describe('runAdd — preserve / heal / pin', () => {
  test('bare re-add pins to the resolved exact version (overwrites existing spec)', async () => {
    registryResolvedVersion = '2.5.0'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '2.5.0')
    writeFacets({ cowsay: '1.*' })
    const result = await add('cowsay')
    expect(result.ok).toBe(true)
    // Bare add always pins to the resolved exact — the manifest-write policy
    // does not preserve existing specs. The user explicitly asked for the
    // newest version; they get it pinned.
    expect(readFacets().cowsay).toBe('2.5.0')
  })

  test('bare re-add heals an invalid recorded value (name leaked into version)', async () => {
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '0.1.1')
    writeFacets({ cowsay: 'cowsay' })
    const result = await add('cowsay')
    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('0.1.1')
  })

  test('bare add pins the resolved exact version when no entry exists', async () => {
    registryResolvedVersion = '0.3.0'
    registryFixtureDir = buildFixture(fakeHome, 'cowsay', '0.3.0')
    const result = await add('cowsay')
    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('0.3.0')
  })
})

describe('runAdd — install-failure restore', () => {
  test('install failure restores facets.json byte-for-byte', async () => {
    // No adapters → runInstall is given an empty adapter set. But the
    // failure we force here is a manifest-name mismatch: the resolved
    // registry name resolves to "cowsay", yet the fixture's facet.json
    // declares a different name, tripping MANIFEST_NAME_MISMATCH inside
    // runInstall after the provisional manifest write.
    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, 'not-cowsay', '0.1.1')
    const before = writeFacets({ 'pre-existing': './fake' })

    const result = await add('cowsay')
    expect(result.ok).toBe(false)

    // facets.json restored to its exact pre-command bytes; the lockfile
    // and receipt were never created.
    const after = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    expect(after).toBe(before)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
    const { receiptPath } = await import('../receipt.ts')
    expect(existsSync(receiptPath(projectRoot))).toBe(false)
  })

  test('a failed add leaves an installed project byte-for-byte unchanged across all three files', async () => {
    // Seed a real project state first: one successful add writes the
    // manifest, lockfile, and receipt. The subsequent FAILING add must
    // leave every one of them byte-identical.
    registryResolvedVersion = '0.9.0'
    registryFixtureDir = buildFixture(fakeHome, 'hello', '0.9.0')
    const seeded = await add('hello')
    expect(seeded.ok).toBe(true)

    const { receiptPath } = await import('../receipt.ts')
    const before = {
      facets: readFileSync(join(projectRoot, 'facets.json'), 'utf8'),
      lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'),
      receipt: readFileSync(receiptPath(projectRoot), 'utf8'),
    }

    registryResolvedVersion = '0.1.1'
    registryFixtureDir = buildFixture(fakeHome, 'not-cowsay', '0.1.1')
    const result = await add('cowsay')
    expect(result.ok).toBe(false)

    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(before.facets)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(before.lock)
    expect(readFileSync(receiptPath(projectRoot), 'utf8')).toBe(before.receipt)
  })
})
