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
let afterManifestParse: (() => void) | null = null
let afterLockfileParse: (() => void) | null = null
let afterReceiptRead: (() => void) | null = null

/** Fire a one-shot hook, then hand back to the real implementation. */
function fire(hook: (() => void) | null): void {
  hook?.()
}

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

// Each hook below fires just after one project file is parsed. An edit landing
// there is what a later, separate observation of that file would adopt as the
// state the plan was computed from.
const realLockfileIo = await import('../lockfile-io.ts')
const realLoadLockfile = realLockfileIo.loadLockfile
mock.module('../lockfile-io.ts', () => ({
  ...realLockfileIo,
  loadLockfile: (root: string) => {
    const hook = afterManifestParse
    afterManifestParse = null
    fire(hook)
    return realLoadLockfile(root)
  },
}))

const realReceipt = await import('../receipt.ts')
const realReadProjectReceipt = realReceipt.readProjectReceipt
mock.module('../receipt.ts', () => ({
  ...realReceipt,
  readProjectReceipt: (dir: string) => {
    const hook = afterLockfileParse
    afterLockfileParse = null
    fire(hook)
    return realReadProjectReceipt(dir)
  },
}))

// The adapter-compatibility preflight runs after all three files are read and
// before anything is written.
const realCompatibility = await import('../../adapters/api-compatibility.ts')
const realCompatibilityFailureFor = realCompatibility.compatibilityFailureFor
mock.module('../../adapters/api-compatibility.ts', () => ({
  ...realCompatibility,
  compatibilityFailureFor: (...args: Parameters<typeof realCompatibilityFailureFor>) => {
    const hook = afterReceiptRead
    afterReceiptRead = null
    fire(hook)
    return realCompatibilityFailureFor(...args)
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
  return loaded.adapters.filter((a) => a.assets !== false)
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
  afterManifestParse = null
  afterLockfileParse = null
  afterReceiptRead = null
})

afterEach(() => {
  onAcquire = null
  afterManifestParse = null
  afterLockfileParse = null
  afterReceiptRead = null
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

// Taking the lock first closes the window BEFORE the read. These cover the
// one after it: a precondition observed later would name a concurrent
// writer's bytes and authorize overwriting them.
describe('runInstall — a commit landing after a project file is parsed', () => {
  test('a manifest edited after it is parsed is refused, not overwritten', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    const beta = buildFixture('beta', 'beta-skill')
    writeManifest({ alpha })

    afterManifestParse = () => writeManifest({ alpha, beta })

    const result = await install()
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FILESYSTEM_TRANSACTION_FAILED')
    expect(Object.keys(readManifestFacets()).sort()).toEqual(['alpha', 'beta'])
  })

  test('a lockfile edited after it is parsed is refused, not overwritten', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    const beta = buildFixture('beta', 'beta-skill')
    writeManifest({ alpha })
    if (!(await install()).ok) expect.unreachable('test bug: fixture install failed')

    // A run whose bytes already match writes nothing, and nothing written is
    // nothing to conflict over — so give this one a real change to commit.
    writeManifest({ alpha, beta })

    const lockfile = join(projectRoot, 'facets.lock')
    // A teammate's newer CLI writing a field this one does not know about.
    // Unrecognized top-level fields are preserved by contract, so a commit
    // derived from the pre-edit parse would silently drop it.
    afterLockfileParse = () => {
      const parsed = JSON.parse(readFileSync(lockfile, 'utf8'))
      writeFileSync(lockfile, `${JSON.stringify({ ...parsed, futureField: 'from a newer CLI' }, null, 2)}\n`)
    }

    const result = await install()
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FILESYSTEM_TRANSACTION_FAILED')
    expect(JSON.parse(readFileSync(lockfile, 'utf8')).futureField).toBe('from a newer CLI')
  })

  test('a receipt edited after it is read is refused, not overwritten', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    const beta = buildFixture('beta', 'beta-skill')
    writeManifest({ alpha })
    if (!(await install()).ok) expect.unreachable('test bug: fixture install failed')

    // Same reason as above: this run must have a receipt worth writing.
    writeManifest({ alpha, beta })

    const receiptFile = realReceipt.receiptPath(projectRoot)
    // Same meaning, different bytes — which is all a precondition compares.
    afterReceiptRead = () => {
      const parsed = JSON.parse(readFileSync(receiptFile, 'utf8'))
      writeFileSync(receiptFile, `${JSON.stringify(parsed, null, 4)}\n`)
    }

    const marker = readFileSync(receiptFile, 'utf8')
    const result = await install()
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FILESYSTEM_TRANSACTION_FAILED')
    expect(readFileSync(receiptFile, 'utf8')).not.toBe(marker)
  })

  test('an install nobody raced still commits', async () => {
    const alpha = buildFixture('alpha', 'alpha-skill')
    writeManifest({ alpha })

    const result = await install()
    expect(result.ok).toBe(true)
    expect(Object.keys(readLockfileFacets())).toEqual(['alpha'])
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
    // as a REMAINING facet — installing the one the user asked to remove.
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
