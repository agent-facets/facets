/**
 * `prepareFacetUpdate` on a real project tree.
 *
 * Two things are proved here that a pure test cannot: that preparation
 * writes absolutely nothing, and that a plan built while the project was
 * being edited underneath it is withdrawn rather than offered.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RegistryMetadata } from '../../../registry/types.ts'
import type { ResolveMetadataBatch } from '../discover.ts'
import { prepareFacetUpdate } from '../prepare.ts'

let projectRoot: string
let fakeHome: string
const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_FACET_DIR = process.env.FACET_DIR

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-update-prepare-'))
  fakeHome = mkdtempSync(join(tmpdir(), 'facet-update-home-'))
  process.env.HOME = fakeHome
  process.env.FACET_DIR = join(fakeHome, '.facet')
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
  if (ORIGINAL_HOME === undefined) delete process.env.HOME
  else process.env.HOME = ORIGINAL_HOME
  if (ORIGINAL_FACET_DIR === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = ORIGINAL_FACET_DIR
})

function writeManifest(facets: Record<string, unknown>, extra = ''): void {
  const body = JSON.stringify({ manifestVersion: 0.2, facets }, null, 2)
  writeFileSync(join(projectRoot, 'facets.json'), extra === '' ? body : `${extra}\n${body}`)
}

function writeLockfile(facets: Record<string, unknown>): void {
  writeFileSync(join(projectRoot, 'facets.lock'), JSON.stringify({ lockfileVersion: 0.3, facets }, null, 2))
}

function lockedRegistry(version: string) {
  return {
    source: { kind: 'registry', registry: 'https://registry.test' },
    version,
    integrity: 'sha256:aaaa',
    assets: [],
  }
}

/** Answers every specifier, optionally running a side effect first. */
function resolver(versions: Record<string, string>, before?: () => void): ResolveMetadataBatch {
  return async (specs) => {
    before?.()
    const value: RegistryMetadata[] = specs.map((spec) => ({
      name: spec.name,
      version: versions[spec.version.kind === 'latest' ? `${spec.name}@latest` : `${spec.name}@target`] ?? '1.0.0',
      transportHash: 'sha256:transport',
      contentFingerprint: 'sha256:content',
    }))
    return { ok: true, value }
  }
}

function projectBytes(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(projectRoot)) {
    out[name] = readFileSync(join(projectRoot, name), 'utf8')
  }
  return out
}

describe('prepareFacetUpdate — producing a plan', () => {
  test('returns a plan bound to the bytes it was built from', async () => {
    writeManifest({ cowsay: '1.*' })
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })

    const result = await prepareFacetUpdate({
      projectRoot,
      resolve: resolver({ 'cowsay@target': '1.8.0', 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    expect(result.prepared.projectRoot).toBe(projectRoot)
    expect(result.prepared.manifestState.kind).toBe('regular-file')
    expect(result.prepared.lockfileState.kind).toBe('regular-file')
    const row = result.prepared.plan[0]
    if (row?.kind !== 'candidate') expect.unreachable()
    expect(row.facet.target.version).toEqual({ kind: 'exact', major: 1, minor: 8, patch: 0 })
  })

  test('an absent lockfile is a snapshot state, not a crash', async () => {
    writeManifest({ cowsay: '1.*' })

    const result = await prepareFacetUpdate({ projectRoot, resolve: resolver({}) })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('unusable-facet-state')
  })

  test('a project with no facets prepares an empty plan', async () => {
    writeManifest({})
    writeLockfile({})

    const result = await prepareFacetUpdate({ projectRoot, resolve: resolver({}) })

    if (!result.ok) expect.unreachable()
    expect(result.prepared.plan).toEqual([])
  })
})

describe('prepareFacetUpdate — side-effect freedom', () => {
  test('leaves every project file byte-for-byte unchanged', async () => {
    writeManifest({ cowsay: '1.*' }, '')
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })
    const before = projectBytes()

    const result = await prepareFacetUpdate({
      projectRoot,
      resolve: resolver({ 'cowsay@target': '1.8.0', 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    expect(projectBytes()).toEqual(before)
  })

  test('creates no receipt, cache, or lock-directory state', async () => {
    writeManifest({ cowsay: '1.*' })
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })

    await prepareFacetUpdate({
      projectRoot,
      resolve: resolver({ 'cowsay@target': '1.8.0', 'cowsay@latest': '2.0.0' }),
    })

    // Nothing under the fake FACET_DIR: no cache entries, and above all no
    // lock directory, which a preview must never leave behind.
    expect(existsSync(join(fakeHome, '.facet'))).toBe(false)
    expect(readdirSync(projectRoot).sort()).toEqual(['facets.json', 'facets.lock'])
  })

  // Side-effect freedom on the happy path is the easy half. A run that
  // fails partway through discovery is the one that could plausibly have
  // written something before giving up.
  test('a failed discovery leaves the project and the machine untouched', async () => {
    writeManifest({ cowsay: '1.*' }, '')
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })
    const before = projectBytes()

    const failing: ResolveMetadataBatch = async () => ({
      ok: false,
      error: { code: 'NETWORK_ERROR', cause: 'registry unreachable', attempts: 3 },
    })

    const result = await prepareFacetUpdate({ projectRoot, resolve: failing })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('discovery-failed')
    expect(projectBytes()).toEqual(before)
    expect(existsSync(join(fakeHome, '.facet'))).toBe(false)
  })

  // An incoherent registry answer is refused later in discovery than a
  // network failure — after metadata is in hand — so it is the arm most
  // likely to have touched something on the way.
  test('an incoherent registry answer also leaves everything untouched', async () => {
    writeManifest({ cowsay: '1.*' }, '')
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })
    const before = projectBytes()

    // `2.0.0` cannot satisfy the authored `1.*`.
    const outOfRange = resolver({ 'cowsay@target': '2.0.0', 'cowsay@latest': '2.0.0' })

    const result = await prepareFacetUpdate({ projectRoot, resolve: outOfRange })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('target-outside-range')
    expect(projectBytes()).toEqual(before)
    expect(existsSync(join(fakeHome, '.facet'))).toBe(false)
  })

  test('preserves manifest formatting and comments it never rewrites', async () => {
    const authored = `{
  // the talking cow
  "manifestVersion": 0.2,
  "facets": { "cowsay": "1.*" }
}
`
    writeFileSync(join(projectRoot, 'facets.json'), authored)
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })

    await prepareFacetUpdate({
      projectRoot,
      resolve: resolver({ 'cowsay@target': '1.8.0', 'cowsay@latest': '2.0.0' }),
    })

    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(authored)
  })
})

describe('prepareFacetUpdate — the project moving underneath', () => {
  test('withdraws the plan when the manifest changes during discovery', async () => {
    writeManifest({ cowsay: '1.*' })
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })

    const result = await prepareFacetUpdate({
      projectRoot,
      resolve: resolver({ 'cowsay@target': '1.8.0', 'cowsay@latest': '2.0.0' }, () => {
        writeManifest({ cowsay: '2.*' })
      }),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'project-changed-during-discovery') expect.unreachable()
    expect(result.failure.file).toBe('manifest')
  })

  test('withdraws the plan when the lockfile changes during discovery', async () => {
    writeManifest({ cowsay: '1.*' })
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })

    const result = await prepareFacetUpdate({
      projectRoot,
      resolve: resolver({ 'cowsay@target': '1.8.0', 'cowsay@latest': '2.0.0' }, () => {
        writeLockfile({ cowsay: lockedRegistry('1.3.0') })
      }),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'project-changed-during-discovery') expect.unreachable()
    expect(result.failure.file).toBe('lockfile')
  })

  test('a whitespace-only manifest edit still withdraws the plan', async () => {
    // The precondition is the exact bytes, not the parsed meaning: the
    // commit writes against those bytes, so anything that changed them
    // invalidates the snapshot.
    writeManifest({ cowsay: '1.*' })
    writeLockfile({ cowsay: lockedRegistry('1.2.0') })

    const result = await prepareFacetUpdate({
      projectRoot,
      resolve: resolver({ 'cowsay@target': '1.8.0', 'cowsay@latest': '2.0.0' }, () => {
        const path = join(projectRoot, 'facets.json')
        writeFileSync(path, `${readFileSync(path, 'utf8')}\n`)
      }),
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('project-changed-during-discovery')
  })
})

describe('prepareFacetUpdate — unreadable project files', () => {
  test('an invalid manifest fails before any registry work', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{ not json')
    let calls = 0
    const result = await prepareFacetUpdate({
      projectRoot,
      resolve: async () => {
        calls += 1
        return { ok: true, value: [] }
      },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('manifest-read')
    expect(calls).toBe(0)
  })

  test('an invalid lockfile fails before any registry work', async () => {
    writeManifest({ cowsay: '1.*' })
    writeFileSync(join(projectRoot, 'facets.lock'), '{ not json')
    let calls = 0
    const result = await prepareFacetUpdate({
      projectRoot,
      resolve: async () => {
        calls += 1
        return { ok: true, value: [] }
      },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('lockfile-read')
    expect(calls).toBe(0)
  })
})
