import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import {
  CURRENT_LOCKFILE_VERSION,
  CURRENT_PROJECT_MANIFEST_VERSION,
  LOCKFILE_VERSION_0_2,
} from '@agent-facets/protocol'
import { loadInstalledAdapters } from '../../adapters/loader.ts'
import { parseFacetSource } from '../../sources/facet/parse-source.ts'
import { runAdd } from '../add/index.ts'
import { CURRENT_RECEIPT_VERSION, receiptPath } from '../receipt.ts'
import { runRemove } from '../remove/index.ts'
import { runInstall } from '../run-install.ts'

/**
 * Transactional guarantees for `facets.json`.
 *
 * These run the REAL install pipeline against local-source fixtures. That
 * matters: the previous generation of manifest tests exercised the pure
 * mutation helpers, which the pipeline stopped calling during the
 * plan/commit refactor — so they kept passing while production silently
 * destroyed every comment in the file. Anything asserted here is asserted
 * against the bytes an actual `facet add` / `install` / `remove` writes.
 */

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined
let adaptersDir: string

/** A local facet fixture inside the project tree, with one skill. */
/**
 * A single-skill local facet whose skill is named after the facet, so
 * installing several fixtures together does not collide on one asset name.
 */
function buildFixture(name: string, version: string): string {
  const dir = join(projectRoot, 'vendor', name)
  mkdirSync(join(dir, `skills/${name}-planning`), { recursive: true })
  writeFileSync(
    join(dir, 'facet.json'),
    JSON.stringify({ name, version, skills: { [`${name}-planning`]: { description: 'planning skill' } } }),
  )
  writeFileSync(join(dir, `skills/${name}-planning/SKILL.md`), `# planning ${version}\n`)
  return `./vendor/${name}`
}

/** A working adapter, or one whose `installAsset` always fails. */
function installFakeAdapter(baseDir: string, name: string, opts: { failInstall?: boolean } = {}): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  const assetFsImport = require.resolve('@agent-facets/adapter')
  const installBody = opts.failInstall
    ? `return { ok: false, failure: { code: 'io-error', message: 'forced failure' } }`
    : `const file = path(req.assetType, req.name)
    await installAssetFile({ file }, req.content, req.metadata)
    return { ok: true, primaryPath: file }`
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
    ${installBody}
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

async function adapters() {
  const loaded = await loadInstalledAdapters()
  if (!loaded.ok) expect.unreachable('test bug: fixture adapters failed to load')
  return loaded.adapters.filter((a) => a.supportsInstall === true)
}

async function add(specifier: string) {
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok) throw new Error(`test bug: unparseable specifier ${specifier}`)
  return runAdd({ projectRoot, sources: [{ specifier, source: parsed.value }], adapters: await adapters() })
}

async function install(opts: { frozenLockfile?: boolean } = {}) {
  return runInstall({ projectRoot, adapters: await adapters(), ...opts })
}

async function remove(name: string) {
  return runRemove({ projectRoot, names: [name], adapters: await adapters() })
}

const manifestPath = () => join(projectRoot, 'facets.json')
const readManifest = () => readFileSync(manifestPath(), 'utf8')
const parseManifest = () => JSON.parse(readManifest().replace(/^\s*\/\/.*$/gm, ''))

function writeManifest(text: string): string {
  writeFileSync(manifestPath(), text)
  return text
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-mtx-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
  installFakeAdapter(adaptersDir, 'test-adapter')
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

describe('legacy migration is transactional', () => {
  test('a successful install migrates an unversioned manifest and preserves every entry', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    writeManifest(`${JSON.stringify({ facets: { alpha: a, beta: b } }, null, 2)}\n`)

    const result = await install()
    expect(result.ok).toBe(true)

    const written = parseManifest()
    expect(written.manifestVersion).toBe(0.1)
    expect(written.facets).toEqual({ alpha: a, beta: b })
  })

  test('a new project starts at the current version', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const result = await add(a)
    expect(result.ok).toBe(true)
    expect(parseManifest().manifestVersion).toBe(0.1)
  })

  // A failed operation must leave the file exactly as it was — not a
  // half-migrated document.
  test('a failed install leaves an unversioned manifest byte-for-byte unchanged', async () => {
    installFakeAdapter(adaptersDir, 'test-adapter', { failInstall: true })
    const a = buildFixture('alpha', '1.0.0')
    const before = writeManifest(`${JSON.stringify({ facets: { alpha: a } }, null, 2)}\n`)

    const result = await install()
    if (result.ok) expect.unreachable()
    // Pin the cause: the point is that a MATERIALIZATION failure leaves the
    // manifest alone, not that the manifest was rejected up front.
    expect(result.failure.code).toBe('ADAPTER_INSTALL_FAILED')
    expect(readManifest()).toBe(before)
  })

  test('a frozen install retains legacy bytes', async () => {
    const a = buildFixture('alpha', '1.0.0')
    writeManifest(`${JSON.stringify({ facets: { alpha: a } }, null, 2)}\n`)
    // Populate the lockfile with a normal install, then restore the legacy
    // manifest so frozen mode sees covered-but-unversioned input.
    expect((await install()).ok).toBe(true)
    const legacy = writeManifest(`${JSON.stringify({ facets: { alpha: a } }, null, 2)}\n`)

    const result = await install({ frozenLockfile: true })
    expect(result.ok).toBe(true)
    expect(readManifest()).toBe(legacy)
  })
})

describe('malformed manifests fail before any mutation', () => {
  test('duplicate members are rejected and nothing is written', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const before = writeManifest(`{"facets":{"alpha":"${a}"},"facets":{"alpha":"${a}"}}`)

    const result = await install()
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FACETS_JSON_INVALID')
    expect(readManifest()).toBe(before)
  })

  test('an unsupported manifestVersion reports observed and supported versions', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const before = writeManifest(`${JSON.stringify({ manifestVersion: 0.9, facets: { alpha: a } }, null, 2)}\n`)

    const result = await install()
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'FACETS_JSON_UNSUPPORTED_VERSION') expect.unreachable()
    expect(result.failure.observed).toBe(0.9)
    expect(result.failure.supported).toEqual([0.1])
    expect(readManifest()).toBe(before)
  })

  test('an expanded entry in an unversioned manifest is rejected', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const before = writeManifest(
      JSON.stringify({
        facets: { alpha: { source: a, materialization: { skills: { 'alpha-planning': { kind: 'omitted' } } } } },
      }),
    )

    const result = await install()
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FACETS_JSON_INVALID')
    expect(readManifest()).toBe(before)
  })
})

describe('expanded entries survive unrelated operations', () => {
  /** A current manifest where `alpha` carries an override and `beta` does not. */
  function seedExpanded(a: string, b: string): void {
    writeManifest(
      `${JSON.stringify(
        {
          manifestVersion: 0.1,
          facets: {
            alpha: {
              source: a,
              materialization: { skills: { 'alpha-planning': { kind: 'aliased', as: 'vendor-planning' } } },
            },
            beta: b,
          },
        },
        null,
        2,
      )}\n`,
    )
  }

  test('an install preserves an untouched expanded entry', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    seedExpanded(a, b)

    expect((await install()).ok).toBe(true)

    expect(parseManifest().facets.alpha).toEqual({
      source: a,
      materialization: { skills: { 'alpha-planning': { kind: 'aliased', as: 'vendor-planning' } } },
    })
  })

  test('removing another facet preserves an expanded entry', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    seedExpanded(a, b)
    expect((await install()).ok).toBe(true)

    const result = await remove('beta')
    expect(result.ok).toBe(true)

    const written = parseManifest()
    expect(written.facets.beta).toBeUndefined()
    expect(written.facets.alpha.materialization.skills['alpha-planning']).toEqual({
      kind: 'aliased',
      as: 'vendor-planning',
    })
  })

  // Changing where a facet comes from is not a statement about how its
  // assets should be named, so a source update must carry overrides through.
  test('re-adding a facet updates its source and keeps its overrides', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    seedExpanded(a, b)
    expect((await install()).ok).toBe(true)

    const result = await add(a)
    expect(result.ok).toBe(true)

    expect(parseManifest().facets.alpha).toEqual({
      source: a,
      materialization: { skills: { 'alpha-planning': { kind: 'aliased', as: 'vendor-planning' } } },
    })
  })
})

describe('comments survive the real install pipeline', () => {
  test('an install preserves file, top-level, and per-entry comments', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    writeManifest(`{
  // file header
  "facets": {
    // about alpha
    "alpha": "${a}",
    // about beta
    "beta": "${b}"
  }
}
`)

    const result = await install()
    expect(result.ok).toBe(true)

    const raw = readManifest()
    expect(raw).toContain('file header')
    expect(raw).toContain('about alpha')
    expect(raw).toContain('about beta')
    expect(parseManifest().manifestVersion).toBe(0.1)
  })

  test('an add preserves comments on untouched entries', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    writeManifest(`{
  "facets": {
    // about alpha
    "alpha": "${a}"
  }
}
`)
    expect((await install()).ok).toBe(true)

    const result = await add(b)
    expect(result.ok).toBe(true)

    const raw = readManifest()
    expect(raw).toContain('about alpha')
    expect(parseManifest().facets.beta).toBe(b)
  })

  test('a remove preserves comments on surviving entries', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    writeManifest(`{
  "facets": {
    // about alpha
    "alpha": "${a}",
    // about beta
    "beta": "${b}"
  }
}
`)
    expect((await install()).ok).toBe(true)

    const result = await remove('beta')
    expect(result.ok).toBe(true)

    const raw = readManifest()
    expect(raw).toContain('about alpha')
    expect(raw).not.toContain('"beta"')
  })
})

describe('every command writes the current formats, and only frozen mode does not', () => {
  // `writeLockfile` and `writeReceipt` accept only the current schemas, so a
  // stale version cannot be re-emitted by construction. What is NOT
  // type-enforced is that every command reaches those writers at all --
  // `commitProjectFiles` is the sole call site, and add/install/remove all
  // have to route through it. These tests pin that routing.

  const lockPath = () => join(projectRoot, 'facets.lock')
  const readLock = () => JSON.parse(readFileSync(lockPath(), 'utf8'))
  const readReceipt = () => JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8'))

  function expectCurrentFormats(): void {
    expect(parseManifest().manifestVersion).toBe(CURRENT_PROJECT_MANIFEST_VERSION)
    expect(readLock().lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
    expect(readReceipt().version).toBe(CURRENT_RECEIPT_VERSION)
  }

  test('facet add writes manifest 0.1, lockfile 0.3, and receipt 0.3', async () => {
    const a = buildFixture('alpha', '1.0.0')
    expect((await add(a)).ok).toBe(true)
    expectCurrentFormats()
  })

  test('facet install writes the current formats', async () => {
    const a = buildFixture('alpha', '1.0.0')
    writeManifest(JSON.stringify({ facets: { alpha: a } }))
    expect((await install()).ok).toBe(true)
    expectCurrentFormats()
  })

  test('facet remove writes the current formats', async () => {
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    expect((await add(a)).ok).toBe(true)
    expect((await add(b)).ok).toBe(true)
    expect((await remove('alpha')).ok).toBe(true)
    expectCurrentFormats()
    expect(parseManifest().facets.alpha).toBeUndefined()
  })

  test('a frozen install retains the loaded versions and writes only the receipt', async () => {
    const a = buildFixture('alpha', '1.0.0')
    expect((await add(a)).ok).toBe(true)

    // Downgrade both version-controlled files in place. Frozen mode must
    // reproduce them as-is rather than migrating: rewriting a lockfile is
    // exactly what the flag forbids, and the receipt is machine-local so it
    // is safe (and necessary) to keep current.
    const lock = readLock()
    lock.lockfileVersion = LOCKFILE_VERSION_0_2
    for (const facet of Object.values(lock.facets) as Array<{ assets: Array<Record<string, unknown>> }>) {
      for (const asset of facet.assets) delete asset.materialization
    }
    writeFileSync(lockPath(), JSON.stringify(lock, null, 2))
    const manifestText = writeManifest(JSON.stringify({ facets: { alpha: a } }, null, 2))

    const lockBefore = readFileSync(lockPath(), 'utf8')
    expect((await install({ frozenLockfile: true })).ok).toBe(true)

    expect(readFileSync(lockPath(), 'utf8')).toBe(lockBefore)
    expect(readLock().lockfileVersion).toBe(LOCKFILE_VERSION_0_2)
    expect(readManifest()).toBe(manifestText)
    expect(parseManifest().manifestVersion).toBeUndefined()
    // The receipt is machine-local, so frozen mode still keeps it current.
    expect(readReceipt().version).toBe(CURRENT_RECEIPT_VERSION)
  })
})

describe('migration and reproduction across formats', () => {
  const lockPath = () => join(projectRoot, 'facets.lock')
  const readLock = () => JSON.parse(readFileSync(lockPath(), 'utf8'))

  test('a non-frozen install migrates a 0.2 lockfile to 0.3, back-filling authored', async () => {
    // The legacy `1` path has had a migration test since dispositions
    // landed; `0.2` only ever had read-side coverage, and both on-disk
    // `0.2` fixtures were frozen installs -- which never write.
    const a = buildFixture('alpha', '1.0.0')
    expect((await add(a)).ok).toBe(true)

    const lock = readLock()
    lock.lockfileVersion = LOCKFILE_VERSION_0_2
    for (const facet of Object.values(lock.facets) as Array<{ assets: Array<Record<string, unknown>> }>) {
      for (const asset of facet.assets) delete asset.materialization
    }
    writeFileSync(lockPath(), JSON.stringify(lock, null, 2))

    expect((await install()).ok).toBe(true)

    const migrated = readLock()
    expect(migrated.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
    for (const facet of Object.values(migrated.facets) as Array<{ assets: Array<Record<string, unknown>> }>) {
      expect(facet.assets.length).toBeGreaterThan(0)
      for (const asset of facet.assets) expect(asset.materialization).toEqual({ kind: 'authored' })
    }
  })

  test('removing the last override collapses the entry without downgrading manifestVersion', async () => {
    // Collapse is well covered; what was not asserted is that the document
    // stays at 0.1 afterwards. A collapse that also dropped the version
    // would silently re-classify the manifest as legacy on the next read,
    // at which point any surviving expanded entry becomes unreadable.
    const a = buildFixture('alpha', '1.0.0')
    expect((await add(a)).ok).toBe(true)

    writeManifest(
      JSON.stringify(
        {
          manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION,
          facets: {
            alpha: {
              source: a,
              materialization: { skills: { 'alpha-planning': { kind: 'aliased', as: 'renamed' } } },
            },
          },
        },
        null,
        2,
      ),
    )
    expect((await install()).ok).toBe(true)
    expect(parseManifest().facets.alpha.materialization).toBeDefined()

    // Drop the override and reinstall: the entry collapses to a string.
    writeManifest(JSON.stringify({ manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION, facets: { alpha: a } }, null, 2))
    expect((await install()).ok).toBe(true)

    const manifest = parseManifest()
    expect(manifest.facets.alpha).toBe(a)
    expect(manifest.manifestVersion).toBe(CURRENT_PROJECT_MANIFEST_VERSION)
  })

  test('a committed manifest and lockfile reproduce in a fresh checkout with no receipt', async () => {
    // The teammate/CI case. Every prior reproduction test reused a project
    // root whose receipt was already written -- but a receipt is keyed by
    // project path and lives outside the tree, so a colleague cloning the
    // repo has none. Reproduction must not depend on it.
    const a = buildFixture('alpha', '1.0.0')
    const b = buildFixture('beta', '2.0.0')
    expect((await add(a)).ok).toBe(true)
    expect((await add(b)).ok).toBe(true)

    const committedManifest = readManifest()
    const committedLock = readFileSync(lockPath(), 'utf8')
    const originalAsset = readFileSync(join(projectRoot, '.test-adapter/skills/alpha-planning.md'), 'utf8')

    // A second project root: the committed pair plus the vendored sources,
    // and deliberately no receipt.
    const clone = realpathSync(mkdtempSync(join(tmpdir(), 'facet-clone-')))
    cpSync(join(projectRoot, 'vendor'), join(clone, 'vendor'), { recursive: true })
    writeFileSync(join(clone, 'facets.json'), committedManifest)
    writeFileSync(join(clone, 'facets.lock'), committedLock)

    const previousRoot = projectRoot
    projectRoot = clone
    process.chdir(clone)
    try {
      expect(existsSync(receiptPath(clone))).toBe(false)
      expect((await install()).ok).toBe(true)

      expect(readManifest()).toBe(committedManifest)
      expect(JSON.parse(readFileSync(lockPath(), 'utf8'))).toEqual(JSON.parse(committedLock))
      expect(readFileSync(join(clone, '.test-adapter/skills/alpha-planning.md'), 'utf8')).toBe(originalAsset)
      expect(existsSync(join(clone, '.test-adapter/skills/beta-planning.md'))).toBe(true)
    } finally {
      projectRoot = previousRoot
      process.chdir(previousRoot)
      rmSync(clone, { recursive: true, force: true })
    }
  })
})
