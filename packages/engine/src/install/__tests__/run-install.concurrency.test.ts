import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter/api-version'

/**
 * Ordering is not enough on its own: acquiring the lock first only matters if
 * the state the commit is DERIVED from is read afterwards. This drives that
 * directly, by committing a concurrent change in the instant the lock is
 * taken and then asserting the commit did not overwrite it.
 *
 * Deterministic by construction — no sleeps, no racing processes. The hook
 * fires exactly once, inside `acquireInstallLock`, which is precisely the
 * moment the old ordering had already captured its snapshot.
 */

let onAcquire: (() => void) | null = null

const realGuard = await import('../lockfile-guard.ts')
// Captured BEFORE the mock is registered. `mock.module` patches the live
// module namespace, so reading `realGuard.acquireInstallLock` at call time
// would resolve to the mock and recurse forever.
const realAcquireInstallLock = realGuard.acquireInstallLock
mock.module('../lockfile-guard.ts', () => ({
  ...realGuard,
  acquireInstallLock: (root: string) => {
    const hook = onAcquire
    onAcquire = null
    hook?.()
    return realAcquireInstallLock(root)
  },
}))

// Imported AFTER the mock so `runInstall` picks up the hooked guard.
const { runInstall } = await import('../run-install.ts')
const { prepareRemove, runRemove } = await import('../run-remove.ts')
const { loadInstalledAdapters } = await import('../../adapters/loader.ts')

let projectRoot: string
let fakeHome: string
let adaptersDir: string
let originalCwd: string
let originalHome: string | undefined
let originalFacetDir: string | undefined

function buildFixture(name: string, skill: string): string {
  const repo = realpathSync(mkdtempSync(join(projectRoot, 'fixture-')))
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({ name, version: '1.0.0', skills: { [skill]: { description: `${skill} skill` } } }),
  )
  mkdirSync(join(repo, `skills/${skill}`), { recursive: true })
  writeFileSync(join(repo, `skills/${skill}/SKILL.md`), `# ${skill}\n`)
  return `./${repo.split('/').pop()}`
}

function installFakeAdapter(name: string): void {
  const dir = join(adaptersDir, name)
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

function writeManifest(facets: Record<string, string>): void {
  writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets }, null, 2))
}

function readManifestFacets(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets
}

function readLockfileFacets(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).facets
}

async function installableAdapters() {
  const loaded = await loadInstalledAdapters()
  if (!loaded.ok) expect.unreachable('test bug: fixture adapters failed to load')
  return loaded.adapters.filter((a) => a.supportsInstall === true)
}

async function install() {
  return runInstall({ projectRoot, adapters: await installableAdapters() })
}

async function remove(names: string[], prepared?: Extract<ReturnType<typeof prepareRemove>, { ok: true }>) {
  return runRemove({
    projectRoot,
    names,
    adapters: await installableAdapters(),
    ...(prepared ? { prepared } : {}),
  })
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-concurrency-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
  installFakeAdapter('test-adapter')
  onAcquire = null
})

afterEach(() => {
  onAcquire = null
  process.chdir(originalCwd)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('runInstall — a commit landing before the lock is acquired', () => {
  test('is not overwritten by this run', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    const beta = buildFixture('beta', 'beta-skill')
    writeManifest({ alpha })

    // "Another process committed just now": the manifest gains `beta` in the
    // instant this run takes the lock. Reading before the lock would have
    // captured the one-facet snapshot and written it back over this.
    onAcquire = () => writeManifest({ alpha, beta })

    const result = await install()
    if (!result.ok) expect.unreachable()

    expect(Object.keys(readManifestFacets()).sort()).toEqual(['alpha', 'beta'])
    expect(Object.keys(readLockfileFacets()).sort()).toEqual(['alpha', 'beta'])
  })
})

describe('runRemove — a facet declared after validation but before the lock', () => {
  test('is still removed, because the request reaches the delta unfiltered', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    const beta = buildFixture('beta', 'beta-skill')
    writeManifest({ alpha })
    if (!(await install()).ok) expect.unreachable('test bug: fixture install failed')

    // The CLI's advisory validation, run before adapters are discovered. It
    // sees a manifest that does not declare `beta` yet — and, by design,
    // reports nothing about that, so no caller can act on it.
    const prepared = prepareRemove({ projectRoot, names: ['alpha', 'beta'] })
    if (!prepared.ok) expect.unreachable()

    // "Another process committed an add of beta" — in the instant this run
    // takes the lock, which is after adapters were discovered.
    onAcquire = () => writeManifest({ alpha, beta })

    const result = await remove(['alpha', 'beta'], prepared)
    if (!result.ok) expect.unreachable()

    // Both were requested, so both are gone. Deriving the delta from the
    // advisory snapshot dropped `beta` from the request and then treated it
    // as a SURVIVOR — installing the facet the user asked to remove.
    expect(Object.keys(readManifestFacets())).toEqual([])
    expect(Object.keys(readLockfileFacets())).toEqual([])
  })

  // The all-absent case, which the CLI used to answer from the advisory read
  // and return without ever taking the lock: every requested name looked
  // undeclared, so the command reported "no changes" while a concurrent add
  // left the facet installed.
  test('is still removed when EVERY requested name looked absent', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    const beta = buildFixture('beta', 'beta-skill')
    writeManifest({ alpha })
    if (!(await install()).ok) expect.unreachable('test bug: fixture install failed')

    const prepared = prepareRemove({ projectRoot, names: ['beta'] })
    if (!prepared.ok) expect.unreachable()

    onAcquire = () => writeManifest({ alpha, beta })

    const result = await remove(['beta'], prepared)
    if (!result.ok) expect.unreachable()

    expect(Object.keys(readManifestFacets())).toEqual(['alpha'])
    expect(Object.keys(readLockfileFacets())).toEqual(['alpha'])
  })

  test('a name absent under the lock too is still a silent no-op', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    writeManifest({ alpha })
    if (!(await install()).ok) expect.unreachable('test bug: fixture install failed')

    const result = await remove(['alpha', 'ghost'])
    if (!result.ok) expect.unreachable()

    expect(Object.keys(readManifestFacets())).toEqual([])
    expect(result.install.perFacet.some((outcome) => outcome.name === 'ghost')).toBe(false)
  })
})
