/**
 * Applying a reviewed update through the real install transaction.
 *
 * The registry metadata resolver and archive download are stubbed the
 * same way `run-add.test.ts` stubs them, so integrity verification runs
 * for real against a genuinely built fixture. What these tests are about
 * is everything the update arm has to keep straight that no other
 * operation does: the manifest value differing from the installed
 * version, the old lock entry being dropped as an anchor but kept for
 * the summary, and the plan being refused if the project moved.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import { ADAPTER_API_VERSION, planSingleFileInstall, planSingleFileRemoval } from '@agent-facets/adapter'
import type { ProjectFacetEntry } from '@agent-facets/protocol'
import { recordingMcpCapability } from './helpers/mcp-adapter.ts'

let registryFixtures: Record<string, string> = {}
let metadataCalls: Array<{ name: string; spec: string }> = []

/** Every published version of a facet, newest last. */
function publishedVersions(name: string): string[] {
  return Object.keys(registryFixtures)
    .filter((key) => key.startsWith(`${name}@`))
    .map((key) => key.slice(name.length + 1))
    .sort(compareVersions)
}

function parts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return [major, minor, patch]
}

function compareVersions(a: string, b: string): number {
  const [am, an, ap] = parts(a)
  const [bm, bn, bp] = parts(b)
  return am - bm || an - bn || ap - bp
}

/** The newest published version satisfying a requested spec. */
function highestSatisfying(name: string, spec: { kind: string; major?: number; minor?: number }): string | undefined {
  const matching = publishedVersions(name).filter((version) => {
    const [major, minor] = parts(version)
    switch (spec.kind) {
      case 'majorWildcard':
        return major === spec.major
      case 'minorWildcard':
        return major === spec.major && minor === spec.minor
      default:
        return true
    }
  })
  return matching.at(-1)
}

async function manifestFor(fixtureDir: string) {
  const { runBuildPipeline } = await import('../../build/pipeline.ts')
  const built = await runBuildPipeline(fixtureDir, [])
  if (!built.ok) throw new Error('test bug: fixture failed to build')
  return JSON.parse(built.manifestJson) as import('@agent-facets/protocol').CurrentBuildManifest
}

function describeSpec(version: { kind: string; major?: number; minor?: number; patch?: number }): string {
  switch (version.kind) {
    case 'exact':
      return `${version.major}.${version.minor}.${version.patch}`
    case 'majorWildcard':
      return `${version.major}.*`
    case 'minorWildcard':
      return `${version.major}.${version.minor}.*`
    default:
      return version.kind === 'wildcard' ? '*' : 'latest'
  }
}

mock.module('../../registry/resolve-metadata.ts', () => ({
  MAX_REGISTRY_METADATA_SPECIFIERS: 100,
  resolveRegistryMetadataBatch: async (
    specs: ReadonlyArray<{ name: string; version: { kind: string; major?: number; minor?: number; patch?: number } }>,
  ) => {
    const value = []
    for (const spec of specs) {
      const requested = describeSpec(spec.version)
      metadataCalls.push({ name: spec.name, spec: requested })
      // Resolve like the real registry: the highest published version that
      // satisfies the request. A fake that ignored the range would let these
      // tests pass while the range logic was broken.
      const version = spec.version.kind === 'exact' ? requested : (highestSatisfying(spec.name, spec.version) ?? '')
      const dir = registryFixtures[`${spec.name}@${version}`]
      if (dir === undefined) return { ok: false, error: { code: 'NOT_FOUND', name: spec.name, spec: requested } }
      value.push({
        name: spec.name,
        version,
        transportHash: 'sha256:stub',
        contentFingerprint: (await manifestFor(dir)).integrity,
      })
    }
    return { ok: true, value }
  },
}))

mock.module('../../registry/download.ts', () => ({
  downloadAndExtractFacet: async (meta: { name: string; version: string }, dest: string) => {
    const dir = registryFixtures[`${meta.name}@${meta.version}`]
    if (dir === undefined) {
      return { ok: false, error: { code: 'NETWORK_ERROR', cause: 'no fixture', attempts: 1 } }
    }
    cpSync(dir, dest, { recursive: true })
    const manifest = await manifestFor(dir)
    return { ok: true, value: { integrity: manifest.integrity, fileHashes: manifest.files } }
  },
}))

const { runAdd } = await import('../run-add.ts')
const { prepareFacetUpdate } = await import('../update/prepare.ts')
const { runPreparedFacetUpdate } = await import('../update/apply.ts')
const { parseFacetSource } = await import('../../sources/facet/parse-source.ts')
const { loadInstalledAdapters } = await import('../../adapters/loader.ts')
type McpConsentPolicy = import('../mcp/consent.ts').McpConsentPolicy

let projectRoot: string
let originalCwd: string
let fakeHome: string
let originalHome: string | undefined
let originalFacetDir: string | undefined
let adaptersDir: string

/**
 * Publish a facet version to the fake registry.
 *
 * The skill is named after the facet so two fixtures can coexist in one
 * project: identically-named skills would collide during materialization,
 * which is a real behavior but not the one these tests are about.
 */
function buildFixture(name: string, version: string): void {
  const repo = realpathSync(mkdtempSync(join(fakeHome, 'fixture-')))
  const skill = `${name}-skill`
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({ name, version, skills: { [skill]: { description: `${name} skill` } } }),
  )
  mkdirSync(join(repo, 'skills', skill), { recursive: true })
  writeFileSync(join(repo, 'skills', skill, 'SKILL.md'), `# ${skill} ${version}\n`)
  registryFixtures[`${name}@${version}`] = repo
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

async function adapters() {
  const loadResult = await loadInstalledAdapters()
  if (!loadResult.ok) expect.unreachable('test bug: installed fixture adapters failed to load')
  return loadResult.adapters.filter((a) => a.assets !== false)
}

/**
 * An in-memory adapter that can carry MCP work.
 *
 * The on-disk fixture adapter declares `mcpServers: false`, which is the
 * right default for every other test here. Consent is a property of the
 * update arm reaching the shared pipeline, and reaching it requires an
 * adapter that would actually write a document.
 */
function mcpCapableAdapter(): Adapter {
  const baseDir = () => join(projectRoot, '.mcp-adapter')
  const file = (type: string, name: string) => join(baseDir(), `${type}s`, `${name}.md`)
  const mcp = recordingMcpCapability(() => join(baseDir(), 'mcp.json'))
  return {
    name: 'mcp-adapter',
    apiVersion: ADAPTER_API_VERSION,
    mcpServers: mcp.capability,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    assets: {
      async planInstall(request) {
        return planSingleFileInstall(
          { file: file(request.assetType, request.name), boundary: baseDir() },
          request.content,
          request.metadata as Record<string, unknown>,
        )
      },
      async planRemoval(request) {
        return planSingleFileRemoval({ file: file(request.assetType, request.name), boundary: baseDir() })
      },
    },
  }
}

/** Publish a version that declares an MCP server alongside its skill. */
function buildServerFixture(name: string, version: string, server: string, declaration: unknown): void {
  const repo = realpathSync(mkdtempSync(join(fakeHome, 'fixture-')))
  const skill = `${name}-skill`
  writeFileSync(
    join(repo, 'facet.json'),
    JSON.stringify({
      name,
      version,
      skills: { [skill]: { description: `${name} skill` } },
      servers: { [server]: declaration },
    }),
  )
  mkdirSync(join(repo, 'skills', skill), { recursive: true })
  writeFileSync(join(repo, 'skills', skill, 'SKILL.md'), `# ${skill} ${version}\n`)
  registryFixtures[`${name}@${version}`] = repo
}

async function add(specifier: string, using?: Adapter[]) {
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok) expect.unreachable(`test bug: unparseable specifier ${specifier}`)
  return runAdd({ projectRoot, sources: [{ specifier, source: parsed.value }], adapters: using ?? (await adapters()) })
}

function readFacets(): Record<string, ProjectFacetEntry> {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).facets
}

function readLock(): {
  facets: Record<string, { version: string; assets: Array<{ name: string; materialization: unknown }> }>
} {
  return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
}

/** Prepare a plan, then apply the given choices. */
async function update(
  selections: Array<{ facetName: string; choice: 'range' | 'latest' }>,
  options: { using?: Adapter[]; mcpConsent?: McpConsentPolicy } = {},
) {
  const prepared = await prepareFacetUpdate({ projectRoot })
  if (!prepared.ok) expect.unreachable(`test bug: prepare failed (${prepared.failure.reason})`)
  metadataCalls = []
  return runPreparedFacetUpdate({
    prepared: prepared.prepared,
    selections,
    adapters: options.using ?? (await adapters()),
    ...(options.mcpConsent ? { mcpConsent: options.mcpConsent } : {}),
  })
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalHome = process.env.HOME
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-runupdate-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-home-')))
  const facetDir = join(fakeHome, '.facet')
  adaptersDir = join(facetDir, 'adapters')
  mkdirSync(adaptersDir, { recursive: true })
  process.env.HOME = fakeHome
  process.env.FACET_DIR = facetDir
  process.chdir(projectRoot)
  installFakeAdapter(adaptersDir, 'test-adapter')
  registryFixtures = {}
  metadataCalls = []
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

// ---------------------------------------------------------------------------
// Applying a choice
// ---------------------------------------------------------------------------

describe('runPreparedFacetUpdate — installing the reviewed version', () => {
  test('a range choice installs the new version and leaves the specifier alone', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    const result = await update([{ facetName: 'cowsay', choice: 'range' }])

    expect(result.ok).toBe(true)
    // The manifest keeps the authored range; only the lockfile moves.
    expect(readFacets().cowsay).toBe('1.*')
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/cowsay-skill.md'), 'utf8')).toContain(
      'cowsay-skill 1.5.0',
    )
  })

  test('a latest choice crossing the range rewrites the specifier in place', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    buildFixture('cowsay', '2.4.1')
    const result = await update([{ facetName: 'cowsay', choice: 'latest' }])

    expect(result.ok).toBe(true)
    // Widened by the smallest edit that includes the selected version, and
    // still a major wildcard — the shape the user chose is preserved.
    expect(readFacets().cowsay).toBe('2.*')
    expect(readLock().facets.cowsay?.version).toBe('2.4.1')
  })

  test('an exact pin moves to the selected exact version', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.0.0')).ok).toBe(true)

    buildFixture('cowsay', '3.0.0')
    const result = await update([{ facetName: 'cowsay', choice: 'latest' }])

    expect(result.ok).toBe(true)
    expect(readFacets().cowsay).toBe('3.0.0')
    expect(readLock().facets.cowsay?.version).toBe('3.0.0')
  })

  test('the summary names the version moved away from', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    const result = await update([{ facetName: 'cowsay', choice: 'range' }])

    if (!result.ok) expect.unreachable()
    // Dropping the old entry as a version ANCHOR must not drop it as the
    // record of what was there before.
    expect(result.install.perFacet).toContainEqual({
      kind: 'updated',
      name: 'cowsay',
      oldVersion: '1.0.0',
      newVersion: '1.5.0',
    })
  })

  test('application asks the registry nothing it already asked during discovery', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    const result = await update([{ facetName: 'cowsay', choice: 'range' }])

    expect(result.ok).toBe(true)
    // `metadataCalls` is reset after prepare, so anything here happened
    // during application — where the answer is already in hand.
    expect(metadataCalls).toEqual([])
  })

  test('a release published after review does not replace the reviewed one', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()

    // A newer release lands between review and application.
    buildFixture('cowsay', '1.6.0')

    const result = await runPreparedFacetUpdate({
      prepared: prepared.prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
    })

    expect(result.ok).toBe(true)
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
  })

  test('two selected facets move together in one commit', async () => {
    buildFixture('cowsay', '1.0.0')
    buildFixture('fortune', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    expect((await add('fortune@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    buildFixture('fortune', '1.9.0')

    const result = await update([
      { facetName: 'cowsay', choice: 'range' },
      { facetName: 'fortune', choice: 'range' },
    ])

    if (!result.ok) expect.unreachable()
    // One transaction, both transitions: the lockfile, both summaries, and
    // both materialized assets all reflect the same commit.
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
    expect(readLock().facets.fortune?.version).toBe('1.9.0')
    expect(result.install.perFacet).toContainEqual({
      kind: 'updated',
      name: 'cowsay',
      oldVersion: '1.0.0',
      newVersion: '1.5.0',
    })
    expect(result.install.perFacet).toContainEqual({
      kind: 'updated',
      name: 'fortune',
      oldVersion: '1.0.0',
      newVersion: '1.9.0',
    })
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/cowsay-skill.md'), 'utf8')).toContain(
      'cowsay-skill 1.5.0',
    )
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/fortune-skill.md'), 'utf8')).toContain(
      'fortune-skill 1.9.0',
    )
  })

  test('an unselected facet keeps reproducing its locked version', async () => {
    buildFixture('cowsay', '1.0.0')
    buildFixture('fortune', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    expect((await add('fortune@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    buildFixture('fortune', '1.9.0')

    const result = await update([{ facetName: 'cowsay', choice: 'range' }])

    expect(result.ok).toBe(true)
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
    expect(readLock().facets.fortune?.version).toBe('1.0.0')
    expect(readFacets().fortune).toBe('1.*')
  })
})

// ---------------------------------------------------------------------------
// Project intent
// ---------------------------------------------------------------------------

describe('runPreparedFacetUpdate — durable project intent', () => {
  test('an alias survives the version change and is recorded at the new version', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    // Record an alias, then reinstall so the lockfile carries the disposition.
    writeFileSync(
      join(projectRoot, 'facets.json'),
      `${JSON.stringify(
        {
          manifestVersion: 0.2,
          facets: {
            cowsay: {
              source: '1.*',
              materialization: { skills: { 'cowsay-skill': { kind: 'aliased', as: 'vendor-plan' } } },
            },
          },
        },
        null,
        2,
      )}\n`,
    )
    const realias = await add('cowsay@1.*')
    if (!realias.ok) expect.unreachable(`test bug: re-add failed (${JSON.stringify(realias)})`)

    buildFixture('cowsay', '1.5.0')
    const result = await update([{ facetName: 'cowsay', choice: 'range' }])

    expect(result.ok).toBe(true)
    // The override is durable project intent: changing which version a facet
    // comes from says nothing about how its assets should be named.
    const entry = readFacets().cowsay
    if (entry === undefined || typeof entry === 'string') expect.unreachable()
    expect(entry.materialization?.skills?.['cowsay-skill']).toEqual({ kind: 'aliased', as: 'vendor-plan' })
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/vendor-plan.md'), 'utf8')).toContain(
      'cowsay-skill 1.5.0',
    )
    // The disposition is re-recorded against the NEW version, not carried
    // over from the old entry: the lockfile has to describe the release
    // that is actually on disk.
    expect(readLock().facets.cowsay?.assets[0]?.materialization).toEqual({ kind: 'aliased', as: 'vendor-plan' })
  })

  test('an omission survives the version change and is recorded at the new version', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    writeFileSync(
      join(projectRoot, 'facets.json'),
      `${JSON.stringify(
        {
          manifestVersion: 0.2,
          facets: {
            cowsay: {
              source: '1.*',
              materialization: { skills: { 'cowsay-skill': { kind: 'omitted' } } },
            },
          },
        },
        null,
        2,
      )}\n`,
    )
    const reomit = await add('cowsay@1.*')
    if (!reomit.ok) expect.unreachable(`test bug: re-add failed (${JSON.stringify(reomit)})`)

    buildFixture('cowsay', '1.5.0')
    const result = await update([{ facetName: 'cowsay', choice: 'range' }])

    expect(result.ok).toBe(true)
    const entry = readFacets().cowsay
    if (entry === undefined || typeof entry === 'string') expect.unreachable()
    expect(entry.materialization?.skills?.['cowsay-skill']).toEqual({ kind: 'omitted' })
    // A newer release does not re-introduce an asset the project decided
    // not to materialize.
    expect(existsSync(join(projectRoot, '.test-adapter/skills/cowsay-skill.md'))).toBe(false)
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
    expect(readLock().facets.cowsay?.assets[0]?.materialization).toEqual({ kind: 'omitted' })
  })

  test('comments and formatting in facets.json survive the rewrite', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    writeFileSync(
      join(projectRoot, 'facets.json'),
      `{
  // the talking cow
  "facets": {
    "cowsay": "1.*"
  }
}
`,
    )

    buildFixture('cowsay', '2.0.0')
    const result = await update([{ facetName: 'cowsay', choice: 'latest' }])

    expect(result.ok).toBe(true)
    const text = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    expect(text).toContain('// the talking cow')
    expect(text).toContain('"cowsay": "2.*"')
  })
})

// ---------------------------------------------------------------------------
// Stale plans
// ---------------------------------------------------------------------------

describe('runPreparedFacetUpdate — the project moving after review', () => {
  async function preparedPlan() {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    buildFixture('cowsay', '1.5.0')
    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()
    return prepared.prepared
  }

  test('a manifest edit after review refuses the plan without touching anything', async () => {
    const prepared = await preparedPlan()
    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    writeFileSync(join(projectRoot, 'facets.json'), `${readFileSync(join(projectRoot, 'facets.json'), 'utf8')}\n`)

    const result = await runPreparedFacetUpdate({
      prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    if (result.install.failure.code !== 'UPDATE_PLAN_STALE') expect.unreachable()
    expect(result.install.failure.files).toEqual(['manifest'])
    // Refused before anything ran, so there is nothing to have rolled back.
    expect(result.install.rollback).toEqual({ kind: 'not-needed', reason: 'post-lock-no-mutation' })
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/cowsay-skill.md'), 'utf8')).toContain(
      'cowsay-skill 1.0.0',
    )
  })

  test('a lockfile edit after review refuses the plan', async () => {
    const prepared = await preparedPlan()
    writeFileSync(join(projectRoot, 'facets.lock'), `${readFileSync(join(projectRoot, 'facets.lock'), 'utf8')}\n`)

    const result = await runPreparedFacetUpdate({
      prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    if (result.install.failure.code !== 'UPDATE_PLAN_STALE') expect.unreachable()
    expect(result.install.failure.files).toEqual(['lockfile'])
  })

  test('both files moving are both reported, in a fixed order', async () => {
    const prepared = await preparedPlan()
    writeFileSync(join(projectRoot, 'facets.json'), `${readFileSync(join(projectRoot, 'facets.json'), 'utf8')}\n`)
    writeFileSync(join(projectRoot, 'facets.lock'), `${readFileSync(join(projectRoot, 'facets.lock'), 'utf8')}\n`)

    const result = await runPreparedFacetUpdate({
      prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    if (result.install.failure.code !== 'UPDATE_PLAN_STALE') expect.unreachable()
    expect(result.install.failure.files).toEqual(['manifest', 'lockfile'])
  })

  test('the gate runs before any registry or download work', async () => {
    const prepared = await preparedPlan()
    writeFileSync(join(projectRoot, 'facets.json'), `${readFileSync(join(projectRoot, 'facets.json'), 'utf8')}\n`)
    metadataCalls = []

    const result = await runPreparedFacetUpdate({
      prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
    })

    expect(result.ok).toBe(false)
    expect(metadataCalls).toEqual([])
  })

  test('an untouched project applies normally', async () => {
    const prepared = await preparedPlan()

    const result = await runPreparedFacetUpdate({
      prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
    })

    expect(result.ok).toBe(true)
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
  })
})

// ---------------------------------------------------------------------------
// Selection validation
// ---------------------------------------------------------------------------

describe('runPreparedFacetUpdate — refusing a selection', () => {
  async function planWith(specifier: string, installed: string, published: string) {
    buildFixture('cowsay', installed)
    expect((await add(specifier)).ok).toBe(true)
    if (published !== installed) {
      buildFixture('cowsay', published)
    }
    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()
    return prepared.prepared
  }

  async function select(prepared: Awaited<ReturnType<typeof planWith>>, selections: Parameters<typeof update>[0]) {
    return runPreparedFacetUpdate({ prepared, selections, adapters: await adapters() })
  }

  test('selecting nothing is refused rather than treated as a no-op install', async () => {
    const prepared = await planWith('cowsay@1.*', '1.0.0', '1.5.0')
    const result = await select(prepared, [])
    if (result.ok) expect.unreachable()
    if (result.phase !== 'selection') expect.unreachable()
    expect(result.failure).toEqual({ reason: 'empty-selection' })
  })

  test('the same facet twice is refused', async () => {
    const prepared = await planWith('cowsay@1.*', '1.0.0', '1.5.0')
    const result = await select(prepared, [
      { facetName: 'cowsay', choice: 'range' },
      { facetName: 'cowsay', choice: 'latest' },
    ])
    if (result.ok) expect.unreachable()
    if (result.phase !== 'selection') expect.unreachable()
    expect(result.failure).toEqual({ reason: 'duplicate-facet', facet: 'cowsay' })
  })

  test('a facet the plan never mentioned is refused', async () => {
    const prepared = await planWith('cowsay@1.*', '1.0.0', '1.5.0')
    const result = await select(prepared, [{ facetName: 'nope', choice: 'range' }])
    if (result.ok) expect.unreachable()
    if (result.phase !== 'selection') expect.unreachable()
    expect(result.failure).toEqual({ reason: 'unknown-facet', facet: 'nope' })
  })

  test('a facet with nothing newer is refused', async () => {
    const prepared = await planWith('cowsay@1.*', '1.0.0', '1.0.0')
    const result = await select(prepared, [{ facetName: 'cowsay', choice: 'range' }])
    if (result.ok) expect.unreachable()
    if (result.phase !== 'selection') expect.unreachable()
    expect(result.failure).toEqual({ reason: 'not-a-candidate', facet: 'cowsay' })
  })

  test('a choice that does not advance is refused even when the row is a candidate', async () => {
    // An exact pin whose Latest moved: the row is offerable, but its range
    // choice still resolves to the version already installed.
    const prepared = await planWith('cowsay@1.0.0', '1.0.0', '2.0.0')
    const result = await select(prepared, [{ facetName: 'cowsay', choice: 'range' }])
    if (result.ok) expect.unreachable()
    if (result.phase !== 'selection') expect.unreachable()
    if (result.failure.reason !== 'choice-does-not-advance') expect.unreachable()
    expect(result.failure.facet).toBe('cowsay')
    expect(result.failure.current).toBe('1.0.0')
    expect(result.failure.version).toBe('1.0.0')
  })

  test('a refused selection writes nothing', async () => {
    const prepared = await planWith('cowsay@1.*', '1.0.0', '1.5.0')
    const before = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    await select(prepared, [{ facetName: 'nope', choice: 'range' }])
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Failure parity
// ---------------------------------------------------------------------------

/**
 * An update is not a special kind of write. It goes through the same
 * resolution, verification, composition, transaction and rollback as add,
 * remove, and install — so when it fails, it has to fail the same way.
 */
describe('runPreparedFacetUpdate — failing like every other operation', () => {
  test('one facet failing verification leaves every facet at its old version', async () => {
    buildFixture('cowsay', '1.0.0')
    buildFixture('fortune', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    expect((await add('fortune@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    buildFixture('fortune', '1.5.0')

    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()

    // Make one of the two selected downloads impossible. The other is
    // perfectly installable, which is the point: partial success would be
    // the bug.
    delete registryFixtures['fortune@1.5.0']

    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    const manifestBefore = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    const result = await runPreparedFacetUpdate({
      prepared: prepared.prepared,
      selections: [
        { facetName: 'cowsay', choice: 'range' },
        { facetName: 'fortune', choice: 'range' },
      ],
      adapters: await adapters(),
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    // Resolution failed, so nothing was ever armed to roll back.
    expect(result.install.rollback.kind).toBe('not-needed')
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(manifestBefore)
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/cowsay-skill.md'), 'utf8')).toContain(
      'cowsay-skill 1.0.0',
    )
  })

  test('an integrity mismatch on the new version is refused and changes nothing', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()

    // Swap the published bytes after the fingerprint was reviewed: what
    // arrives no longer matches what the registry attested to.
    const tampered = realpathSync(mkdtempSync(join(fakeHome, 'tampered-')))
    writeFileSync(
      join(tampered, 'facet.json'),
      JSON.stringify({ name: 'cowsay', version: '1.5.0', skills: { 'cowsay-skill': { description: 'cowsay skill' } } }),
    )
    mkdirSync(join(tampered, 'skills/cowsay-skill'), { recursive: true })
    writeFileSync(join(tampered, 'skills/cowsay-skill/SKILL.md'), '# tampered\n')
    registryFixtures['cowsay@1.5.0'] = tampered

    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    const result = await runPreparedFacetUpdate({
      prepared: prepared.prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    expect(result.install.failure.code).toBe('INTEGRITY_FAILURE')
    // The disk-state report is part of the failure contract, not an
    // afterthought: the user is told the project is intact.
    expect(result.install.rollback.kind).toBe('not-needed')
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/cowsay-skill.md'), 'utf8')).toContain(
      'cowsay-skill 1.0.0',
    )
  })

  // The literal atomicity claim: several facets selected, one of them
  // fails INTEGRITY verification specifically, and none of the others
  // are left committed. The sibling test above fails at resolution,
  // which never arms a transaction at all — a weaker starting point.
  test('one facet failing integrity leaves the others at their old versions too', async () => {
    buildFixture('cowsay', '1.0.0')
    buildFixture('fortune', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    expect((await add('fortune@1.*')).ok).toBe(true)

    buildFixture('cowsay', '1.5.0')
    buildFixture('fortune', '1.5.0')

    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()

    // Swap fortune's published bytes after the fingerprint was reviewed.
    const tampered = realpathSync(mkdtempSync(join(fakeHome, 'tampered-')))
    writeFileSync(
      join(tampered, 'facet.json'),
      JSON.stringify({
        name: 'fortune',
        version: '1.5.0',
        skills: { 'fortune-skill': { description: 'fortune skill' } },
      }),
    )
    mkdirSync(join(tampered, 'skills/fortune-skill'), { recursive: true })
    writeFileSync(join(tampered, 'skills/fortune-skill/SKILL.md'), '# tampered\n')
    registryFixtures['fortune@1.5.0'] = tampered

    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    const manifestBefore = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    const result = await runPreparedFacetUpdate({
      prepared: prepared.prepared,
      selections: [
        { facetName: 'cowsay', choice: 'range' },
        { facetName: 'fortune', choice: 'range' },
      ],
      adapters: await adapters(),
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    expect(result.install.failure.code).toBe('INTEGRITY_FAILURE')
    // The perfectly installable facet does not get to move on its own.
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(manifestBefore)
    expect(readFileSync(join(projectRoot, '.test-adapter/skills/cowsay-skill.md'), 'utf8')).toContain(
      'cowsay-skill 1.0.0',
    )
    // And the user is told the project is intact.
    expect(result.install.rollback.kind).toBe('not-needed')
  })

  test('a collision introduced by the new version is reported before anything is written', async () => {
    buildFixture('cowsay', '1.0.0')
    buildFixture('fortune', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    expect((await add('fortune@1.*')).ok).toBe(true)

    // The new cowsay publishes a skill named exactly like fortune's.
    const clashing = realpathSync(mkdtempSync(join(fakeHome, 'clash-')))
    writeFileSync(
      join(clashing, 'facet.json'),
      JSON.stringify({
        name: 'cowsay',
        version: '1.5.0',
        skills: { 'fortune-skill': { description: 'clashing skill' } },
      }),
    )
    mkdirSync(join(clashing, 'skills/fortune-skill'), { recursive: true })
    writeFileSync(join(clashing, 'skills/fortune-skill/SKILL.md'), '# clash\n')
    registryFixtures['cowsay@1.5.0'] = clashing

    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    const result = await update([{ facetName: 'cowsay', choice: 'range' }])

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    // No resolver was supplied, so the complete report is the answer — the
    // same thing a non-interactive add or install would get.
    expect(result.install.failure.code).toBe('MATERIALIZATION_COLLISION')
    expect(result.install.rollback.kind).toBe('not-needed')
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)
  })

  test('a new version that declares an MCP server enters the consent path', async () => {
    const adapter = mcpCapableAdapter()
    // v1 is skills only, so the project has approved no configuration.
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*', [adapter])).ok).toBe(true)

    // v2 brings a server with it — configuration the user has not seen.
    buildServerFixture('cowsay', '1.5.0', 'files', {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'server-filesystem'],
    })

    const lockBefore = readFileSync(join(projectRoot, 'facets.lock'), 'utf8')
    const document = join(projectRoot, '.mcp-adapter/mcp.json')

    const refused = await update([{ facetName: 'cowsay', choice: 'range' }], {
      using: [adapter],
      mcpConsent: { kind: 'unavailable' },
    })

    if (refused.ok) expect.unreachable()
    if (refused.phase !== 'install') expect.unreachable()
    expect(refused.install.failure.code).toBe('MCP_CONSENT_REQUIRED')
    // Refused before mutation, like every other operation: no document, no
    // version change.
    expect(existsSync(document)).toBe(false)
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lockBefore)

    const accepted = await update([{ facetName: 'cowsay', choice: 'range' }], {
      using: [adapter],
      mcpConsent: { kind: 'preapproved' },
    })

    expect(accepted.ok).toBe(true)
    expect(readLock().facets.cowsay?.version).toBe('1.5.0')
    expect(JSON.parse(readFileSync(document, 'utf8'))).toHaveProperty('files')
  })

  test('a cancelled run reports its disk state the way any other operation does', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    buildFixture('cowsay', '1.5.0')

    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()

    const controller = new AbortController()
    controller.abort()
    const result = await runPreparedFacetUpdate({
      prepared: prepared.prepared,
      selections: [{ facetName: 'cowsay', choice: 'range' }],
      adapters: await adapters(),
      signal: controller.signal,
    })

    if (result.ok) expect.unreachable()
    if (result.phase !== 'install') expect.unreachable()
    expect(result.install.failure.code).toBe('ABORTED')
    expect(result.install.rollback).toEqual({ kind: 'not-needed', reason: 'post-lock-no-mutation' })
  })

  test('a concurrent lock holder is refused before the plan is even consulted', async () => {
    buildFixture('cowsay', '1.0.0')
    expect((await add('cowsay@1.*')).ok).toBe(true)
    buildFixture('cowsay', '1.5.0')

    const prepared = await prepareFacetUpdate({ projectRoot })
    if (!prepared.ok) expect.unreachable()

    const { acquireInstallLock } = await import('../lockfile-guard.ts')
    const held = acquireInstallLock(projectRoot)
    if (!held.ok) expect.unreachable()
    try {
      const result = await runPreparedFacetUpdate({
        prepared: prepared.prepared,
        selections: [{ facetName: 'cowsay', choice: 'range' }],
        adapters: await adapters(),
      })
      if (result.ok) expect.unreachable()
      if (result.phase !== 'install') expect.unreachable()
      expect(result.install.failure.code).toBe('LOCK_HELD')
      expect(result.install.rollback).toEqual({ kind: 'not-needed', reason: 'pre-lock' })
    } finally {
      held.lock.release()
    }
  })
})
