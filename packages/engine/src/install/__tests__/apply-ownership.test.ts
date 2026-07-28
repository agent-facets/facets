import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import {
  ADAPTER_API_VERSION,
  deleteAssetFile,
  deleteSkillBundle,
  installAssetFile,
  installSkillBundle,
  readAssetFile,
  readSkillBundle,
} from '@agent-facets/adapter'
import { CURRENT_RECEIPT_VERSION, type Receipt, receiptPath, writeReceipt } from '../receipt.ts'
import { runInstall } from '../run-install.ts'

/**
 * Effective-identity materialization and global ownership reconciliation,
 * exercised through the real install pipeline with a real skill-bundle
 * adapter.
 *
 * The adapter here uses the published SDK helpers verbatim and derives the
 * bundle directory from `request.name`, exactly as every first-party adapter
 * does. That is what makes these tests able to observe the load-bearing
 * property: an aliased asset must land under its EFFECTIVE name while its
 * content, description, and companions are still looked up by its AUTHORED
 * name.
 */

let projectRoot: string
let originalCwd: string
let originalFacetDir: string | undefined
let fakeHome: string

/** Where the test adapter puts things. */
function base(): string {
  return join(projectRoot, '.rec')
}
function skillRoot(name: string): string {
  return join(base(), 'skills', name)
}
function flatFile(type: string, name: string): string {
  return join(base(), `${type}s`, `${name}.md`)
}

/** An adapter that stores real skill bundles and records every request. */
function recordingAdapter(opts: { failInstallOf?: ReadonlySet<string> } = {}): { adapter: Adapter; io: string[] } {
  const io: string[] = []
  const paths = (name: string) => ({
    root: skillRoot(name),
    primaryFile: join(skillRoot(name), 'SKILL.md'),
    pruneBoundary: base(),
  })
  return {
    io,
    adapter: {
      name: 'rec',
      apiVersion: ADAPTER_API_VERSION,
      supportsInstall: true,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      async installAsset(request) {
        io.push(`install:${request.assetType}:${request.name}`)
        if (opts.failInstallOf?.has(request.name)) {
          return { ok: false, failure: { code: 'io-failed', operation: 'write', message: 'simulated write failure' } }
        }
        if (request.assetType === 'skill') {
          return await installSkillBundle(paths(request.name), {
            content: request.content,
            metadata: request.metadata as Record<string, unknown> | undefined,
            companions: request.companions,
            ownedCompanionPaths: request.ownedCompanionPaths,
          })
        }
        const file = flatFile(request.assetType, request.name)
        mkdirSync(join(file, '..'), { recursive: true })
        await installAssetFile({ file }, request.content, request.metadata as Record<string, unknown> | undefined)
        return { ok: true, primaryPath: file }
      },
      async readAsset(request) {
        io.push(`read:${request.assetType}:${request.name}`)
        if (request.assetType === 'skill') {
          return await readSkillBundle(paths(request.name), request.ownedCompanionPaths)
        }
        try {
          const r = await readAssetFile({ file: flatFile(request.assetType, request.name) })
          return { ok: true, asset: { assetType: request.assetType, content: r.content, metadata: r.metadata } }
        } catch {
          return { ok: false, failure: { code: 'not-found' } }
        }
      },
      async deleteAsset(request) {
        io.push(`delete:${request.assetType}:${request.name}`)
        if (request.assetType === 'skill') {
          return await deleteSkillBundle(paths(request.name), request.ownedCompanionPaths)
        }
        const file = flatFile(request.assetType, request.name)
        const existed = existsSync(file)
        await deleteAssetFile({ file })
        return { ok: true, existed, deletedPaths: existed ? [file] : [] }
      },
    },
  }
}

/**
 * A local facet declaring one skill, optionally with companion files.
 * Companions are declared in `facet.json` so the build pipeline owns them.
 */
function skillFixture(
  facet: string,
  skill: string,
  opts: { companions?: Record<string, string>; version?: string } = {},
): string {
  const dir = join(projectRoot, 'vendor', facet)
  const files = Object.keys(opts.companions ?? {})
  mkdirSync(join(dir, `skills/${skill}`), { recursive: true })
  writeFileSync(
    join(dir, 'facet.json'),
    JSON.stringify({
      name: facet,
      version: opts.version ?? '1.0.0',
      skills: { [skill]: { description: `${skill} of ${facet}`, ...(files.length > 0 ? { files } : {}) } },
    }),
  )
  writeFileSync(join(dir, `skills/${skill}/SKILL.md`), `# ${skill} from ${facet}\n`)
  for (const [path, body] of Object.entries(opts.companions ?? {})) {
    const target = join(dir, `skills/${skill}`, path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, body)
  }
  return `./vendor/${facet}`
}

function writeManifest(value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`
  writeFileSync(join(projectRoot, 'facets.json'), text)
  return text
}

function readReceipt(): Receipt {
  return JSON.parse(readFileSync(receiptPath(projectRoot), 'utf8')) as Receipt
}

beforeEach(() => {
  originalCwd = process.cwd()
  originalFacetDir = process.env.FACET_DIR
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-apply-')))
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'facet-apply-home-')))
  process.env.FACET_DIR = join(fakeHome, '.facet')
  process.chdir(projectRoot)
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalFacetDir === undefined) delete process.env.FACET_DIR
  else process.env.FACET_DIR = originalFacetDir
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fakeHome, { recursive: true, force: true })
})

describe('apply — aliased assets materialize under the effective name', () => {
  test('an aliased skill lands under its alias with authored content and companions', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const { adapter, io } = recordingAdapter()

    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (!result.ok) expect.unreachable()

    // The adapter was addressed with the effective name, never the authored one.
    expect(io).toContain('install:skill:vendor-review')
    expect(io.some((c) => c.includes(':review'))).toBe(false)

    // The bundle is on disk under the alias, companion included.
    expect(existsSync(join(skillRoot('vendor-review'), 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(skillRoot('vendor-review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
    expect(existsSync(skillRoot('review'))).toBe(false)

    // Content and description stayed authored; only front-matter `name`,
    // which labels the file on disk, follows the alias.
    const primary = readFileSync(join(skillRoot('vendor-review'), 'SKILL.md'), 'utf8')
    expect(primary).toContain('# review from alpha')
    expect(primary).toContain('description: review of alpha')
    expect(primary).toContain('name: vendor-review')

    // Integrity records stay anchored to the authored archive paths.
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    const asset = lock.facets.alpha.assets[0]
    expect(asset.name).toBe('review')
    expect(asset.materialization).toEqual({ kind: 'aliased', as: 'vendor-review' })
    expect(asset.files.map((f: { path: string }) => f.path)).toEqual([
      'skills/review/SKILL.md',
      'skills/review/refs/api.md',
    ])

    // The receipt records authored identity + the disposition needed to
    // address the file offline later.
    const receipt = readReceipt()
    expect(receipt.facets.alpha?.assets[0]?.name).toBe('review')
    expect(receipt.facets.alpha?.assets[0]?.materialization).toEqual({ kind: 'aliased', as: 'vendor-review' })
    expect(receipt.facets.alpha?.assets[0]?.files).toEqual(['skills/review/SKILL.md', 'skills/review/refs/api.md'])
  })

  test('re-running an aliased install is a no-op, not a perpetual repair', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const { adapter } = recordingAdapter()

    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)
    const second = await runInstall({ projectRoot, adapters: [adapter] })
    if (!second.ok) expect.unreachable()

    // If the companion lookup keyed off the effective name, the bundle would
    // read as "companions missing" and be rewritten every single run.
    expect(second.summary.totalAssets).toBe(0)
    expect(second.perFacet).toEqual([{ kind: 'unchanged', name: 'alpha', version: '1.0.0' }])
  })
})

describe('apply — global ownership reconciliation', () => {
  test('an identity transferred between facets is not deleted after being written', async () => {
    // `alpha` owns skill `review`. It is then removed while `beta` aliases its
    // own skill onto exactly that name. Per-facet deletion used to run
    // alpha's cleanup independently of beta's write, so the file was deleted
    // after being written whenever alpha sorted second.
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter } = recordingAdapter()
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)
    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(true)

    writeManifest({
      manifestVersion: 0.1,
      facets: { beta: { source: b, materialization: { skills: { other: { kind: 'aliased', as: 'review' } } } } },
    })
    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (!result.ok) expect.unreachable()

    // The identity survives and holds the NEW owner's content.
    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# other from beta')
    // beta's authored name is gone from disk; the alias replaced it.
    expect(existsSync(skillRoot('other'))).toBe(false)
    expect(readReceipt().facets.alpha).toBeUndefined()
  })

  test('an obsolete identity claimed by two historical facets is deleted once', async () => {
    // A hand-written receipt with a duplicate claim: two facets both recorded
    // ownership of `project:skill:shared`, with different companion sets.
    // Deleting per claim would issue two deletes for one file.
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter()
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)

    mkdirSync(skillRoot('shared'), { recursive: true })
    mkdirSync(join(skillRoot('shared'), 'refs'), { recursive: true })
    writeFileSync(join(skillRoot('shared'), 'SKILL.md'), '# stale\n')
    writeFileSync(join(skillRoot('shared'), 'refs/one.md'), '# one\n')
    writeFileSync(join(skillRoot('shared'), 'refs/two.md'), '# two\n')

    const receipt = readReceipt()
    const claim = (_facet: string, companion: string): Receipt['facets'][string] => ({
      version: '1.0.0',
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'shared',
          materialization: { kind: 'authored' },
          files: ['skills/shared/SKILL.md', `skills/shared/${companion}`],
        },
      ],
    })
    writeReceipt(projectRoot, {
      version: CURRENT_RECEIPT_VERSION,
      path: projectRoot,
      facets: { ...receipt.facets, ghostA: claim('ghostA', 'refs/one.md'), ghostB: claim('ghostB', 'refs/two.md') },
    })

    io.length = 0
    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (!result.ok) expect.unreachable()

    // Exactly one delete for the shared identity.
    expect(io.filter((c) => c === 'delete:skill:shared')).toHaveLength(1)
    // Both claimants' companions were removed — the union, not just one set.
    expect(existsSync(skillRoot('shared'))).toBe(false)
    // Counted once, not once per claim.
    expect(result.summary.removedAssets).toBe(1)
  })

  test('changing an alias deletes the old identity and writes the new one', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const aliased = (as: string) => ({
      manifestVersion: 0.1,
      facets: { alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as } } } } },
    })

    writeManifest(aliased('vendor-review'))
    const { adapter, io } = recordingAdapter()
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)
    expect(existsSync(join(skillRoot('vendor-review'), 'refs/api.md'))).toBe(true)

    writeManifest(aliased('partner-review'))
    io.length = 0
    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (!result.ok) expect.unreachable()

    // Old bundle gone in full, new bundle complete.
    expect(existsSync(skillRoot('vendor-review'))).toBe(false)
    expect(readFileSync(join(skillRoot('partner-review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
    expect(io).toContain('delete:skill:vendor-review')
    expect(io).toContain('install:skill:partner-review')

    // A disposition change at an unchanged version is an update, not a repair:
    // the facet's state really did change, and nothing had drifted on disk.
    expect(result.perFacet).toEqual([{ kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' }])
  })

  test('omitting an installed asset removes its whole bundle, and un-omitting restores it', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter()
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)
    expect(existsSync(join(skillRoot('review'), 'refs/api.md'))).toBe(true)

    writeManifest({
      manifestVersion: 0.1,
      facets: { alpha: { source: a, materialization: { skills: { review: { kind: 'omitted' } } } } },
    })
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)
    expect(existsSync(skillRoot('review'))).toBe(false)
    // Still locked — an omission is a materialization choice, not a removal.
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lock.facets.alpha.assets[0].materialization).toEqual({ kind: 'omitted' })
    expect(readReceipt().facets.alpha?.assets).toEqual([])

    writeManifest({ facets: { alpha: a } })
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)
    expect(readFileSync(join(skillRoot('review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
  })

  test('a write failure after a global delete rolls the deleted bundle back', async () => {
    // `alpha` is omitted (so its bundle is deleted in the global delete pass)
    // in the same operation that rewrites `beta` — and beta's write fails.
    // The delete happened first, so rollback must restore it; otherwise a
    // failed install silently destroys an asset it was never asked to change.
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    expect((await runInstall({ projectRoot, adapters: [recordingAdapter().adapter] })).ok).toBe(true)
    expect(existsSync(join(skillRoot('review'), 'refs/api.md'))).toBe(true)

    // Change beta's content so its write is not skipped as identical.
    writeFileSync(join(projectRoot, 'vendor/beta/skills/other/SKILL.md'), '# other v2\n')
    writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'omitted' } } } },
        beta: b,
      },
    })

    const { adapter, io } = recordingAdapter({ failInstallOf: new Set(['other']) })
    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ADAPTER_INSTALL_FAILED')
    expect(result.rollback.kind).toBe('succeeded')

    // Deletion preceded the failed write, and was undone.
    expect(io.indexOf('delete:skill:review')).toBeLessThan(io.indexOf('install:skill:other'))
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# review from alpha')
    expect(readFileSync(join(skillRoot('review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
  })

  test('a file the receipt does not own survives cleanup', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter()
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)

    // A user's own note inside the bundle directory.
    const note = join(skillRoot('review'), 'notes.txt')
    writeFileSync(note, 'mine\n')

    writeManifest({ facets: {} })
    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (!result.ok) expect.unreachable()

    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(false)
    expect(readFileSync(note, 'utf8')).toBe('mine\n')
  })

  test('an aliased asset is removed offline from the receipt alone', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const { adapter, io } = recordingAdapter()
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)

    // Delete the source tree entirely: removal must not need to resolve or
    // rebuild anything. The receipt's recorded disposition is the only thing
    // that knows the bundle is at `vendor-review` rather than `review`.
    rmSync(join(projectRoot, 'vendor'), { recursive: true, force: true })
    writeManifest({ facets: {} })

    io.length = 0
    const result = await runInstall({ projectRoot, adapters: [adapter] })
    if (!result.ok) expect.unreachable()

    expect(io).toContain('delete:skill:vendor-review')
    expect(existsSync(skillRoot('vendor-review'))).toBe(false)
    expect(result.perFacet).toEqual([{ kind: 'removed', name: 'alpha', oldVersion: '1.0.0' }])
  })
})

describe('apply — frozen reproduction of recorded intent', () => {
  /** Install once so a lockfile and receipt exist, then hand back the bytes. */
  async function seed(manifest: unknown): Promise<{ adapter: Adapter; lock: string; manifestText: string }> {
    const manifestText = writeManifest(manifest)
    const { adapter } = recordingAdapter()
    expect((await runInstall({ projectRoot, adapters: [adapter] })).ok).toBe(true)
    return { adapter, lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'), manifestText }
  }

  function expectUntouched(lock: string, manifestText: string): void {
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lock)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(manifestText)
  }

  test('recorded dispositions reproduce without prompting or rewriting', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const { adapter, lock } = await seed({
      manifestVersion: 0.1,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const manifestText = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    let prompted = false
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      frozenLockfile: true,
      resolveCollisions: async () => {
        prompted = true
        return { kind: 'cancelled' }
      },
    })
    if (!result.ok) expect.unreachable()
    expect(prompted).toBe(false)
    expect(result.summary.totalAssets).toBe(0)
    expect(existsSync(join(skillRoot('vendor-review'), 'refs/api.md'))).toBe(true)
    expectUntouched(lock, manifestText)
  })

  test('an alias the lockfile does not record is drift, not a silent re-materialization', async () => {
    const a = skillFixture('alpha', 'review')
    const { adapter, lock } = await seed({ facets: { alpha: a } })

    const manifestText = writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const result = await runInstall({ projectRoot, adapters: [adapter], frozenLockfile: true })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()

    const entry = result.failure.facets[0]
    if (entry?.reason !== 'materialization-drift') expect.unreachable()
    expect(entry.name).toBe('alpha')
    expect(entry.authoredName).toBe('review')
    expect(entry.manifest).toEqual({ kind: 'aliased', as: 'vendor-review' })
    expect(entry.locked).toEqual({ kind: 'authored' })

    // Nothing moved: the authored bundle is still the one on disk.
    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(true)
    expect(existsSync(skillRoot('vendor-review'))).toBe(false)
    expectUntouched(lock, manifestText)
  })

  test('an override naming an absent locked asset is drift and is never pruned', async () => {
    const a = skillFixture('alpha', 'review')
    const { adapter, lock } = await seed({ facets: { alpha: a } })

    const manifestText = writeManifest({
      manifestVersion: 0.1,
      facets: { alpha: { source: a, materialization: { skills: { gone: { kind: 'omitted' } } } } },
    })
    const result = await runInstall({ projectRoot, adapters: [adapter], frozenLockfile: true })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    const entry = result.failure.facets[0]
    if (entry?.reason !== 'stale-override') expect.unreachable()
    expect(entry.authoredName).toBe('gone')
    // A normal install prunes this; frozen mode must leave it exactly alone.
    expectUntouched(lock, manifestText)
  })

  test('a collision in recorded state fails before anything is resolved', async () => {
    // Two facets whose locked assets collide once the manifest's alias is
    // applied. Coverage is fine — both are locked — so this reaches the
    // materialization planner, which is the check under test.
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other')
    const { adapter, lock } = await seed({ facets: { alpha: a, beta: b } })

    const manifestText = writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: a,
        beta: { source: b, materialization: { skills: { other: { kind: 'aliased', as: 'review' } } } },
      },
    })
    // Delete the sources. If the gate ran after resolution, this would fail
    // with a resolve error instead — so reaching a collision report proves the
    // check happened before anything was fetched, cloned, or built.
    rmSync(join(projectRoot, 'vendor'), { recursive: true, force: true })

    let prompted = false
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      frozenLockfile: true,
      resolveCollisions: async () => {
        prompted = true
        return { kind: 'cancelled' }
      },
    })
    if (result.ok) expect.unreachable()
    // Coverage is fine, so this must be the collision report — with every
    // claimant named, exactly as a non-interactive install would get it.
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()
    expect(result.failure.groups).toHaveLength(1)
    expect(result.failure.groups[0]?.members.map((m) => m.facet).sort()).toEqual(['alpha', 'beta'])
    expect(prompted).toBe(false)
    expectUntouched(lock, manifestText)
  })

  test('a lockfile predating dispositions cannot reproduce an alias', async () => {
    const a = skillFixture('alpha', 'review')
    const { adapter } = await seed({ facets: { alpha: a } })

    // Rewrite the lockfile as the previous format: same content, no
    // dispositions. A frozen install must refuse rather than pretend the
    // absent field agrees with the manifest's alias.
    const current = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    const downgraded = {
      lockfileVersion: 0.2,
      facets: {
        alpha: {
          ...current.facets.alpha,
          assets: current.facets.alpha.assets.map((asset: Record<string, unknown>) => {
            const { materialization: _dropped, ...rest } = asset
            return rest
          }),
        },
      },
    }
    const lock = `${JSON.stringify(downgraded, null, 2)}\n`
    writeFileSync(join(projectRoot, 'facets.lock'), lock)

    const manifestText = writeManifest({
      manifestVersion: 0.1,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const result = await runInstall({ projectRoot, adapters: [adapter], frozenLockfile: true })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    const entry = result.failure.facets[0]
    if (entry?.reason !== 'materialization-unrepresentable') expect.unreachable()
    expect(entry.lockfileVersion).toBe(0.2)
    expect(entry.requiredVersion).toBe(0.3)
    expectUntouched(lock, manifestText)
  })

  test('a lockfile predating dispositions still reproduces a project with no overrides', async () => {
    // The guard above must not become a blanket refusal of earlier formats:
    // without overrides there is nothing the old schema cannot express.
    const a = skillFixture('alpha', 'review')
    const { adapter } = await seed({ facets: { alpha: a } })

    const current = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    const downgraded = {
      lockfileVersion: 0.2,
      facets: {
        alpha: {
          ...current.facets.alpha,
          assets: current.facets.alpha.assets.map((asset: Record<string, unknown>) => {
            const { materialization: _dropped, ...rest } = asset
            return rest
          }),
        },
      },
    }
    const lock = `${JSON.stringify(downgraded, null, 2)}\n`
    writeFileSync(join(projectRoot, 'facets.lock'), lock)
    const manifestText = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    const result = await runInstall({ projectRoot, adapters: [adapter], frozenLockfile: true })
    if (!result.ok) expect.unreachable()
    expectUntouched(lock, manifestText)
  })

  test('a frozen add is refused before the lockfile is even read', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    // A lockfile that cannot be parsed at all. If the delta check ran after
    // the load, the user would be told to fix this file instead of being told
    // that a frozen add is impossible in the first place.
    writeFileSync(join(projectRoot, 'facets.lock'), '{ not json')
    const { adapter } = recordingAdapter()

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      frozenLockfile: true,
      delta: { additions: [], removals: [{ facetName: 'alpha' }] },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('FROZEN_WITH_DELTA')
    expect(result.rollback.kind).toBe('not-needed')
  })
})
