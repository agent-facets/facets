import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'
import { loadInstalledAdapters } from '../../adapters/loader.ts'
import { parseFacetSource } from '../../sources/facet/parse-source.ts'
import { runAdd } from '../add/index.ts'
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
function buildFixture(name: string, version: string): string {
  const dir = join(projectRoot, 'vendor', name)
  mkdirSync(join(dir, 'skills/planning'), { recursive: true })
  writeFileSync(
    join(dir, 'facet.json'),
    JSON.stringify({ name, version, skills: { planning: { description: 'planning skill' } } }),
  )
  writeFileSync(join(dir, 'skills/planning/SKILL.md'), `# planning ${version}\n`)
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
        facets: { alpha: { source: a, materialization: { skills: { planning: { kind: 'omitted' } } } } },
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
            alpha: { source: a, materialization: { skills: { planning: { kind: 'aliased', as: 'alpha-planning' } } } },
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
      materialization: { skills: { planning: { kind: 'aliased', as: 'alpha-planning' } } },
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
    expect(written.facets.alpha.materialization.skills.planning).toEqual({
      kind: 'aliased',
      as: 'alpha-planning',
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
      materialization: { skills: { planning: { kind: 'aliased', as: 'alpha-planning' } } },
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
