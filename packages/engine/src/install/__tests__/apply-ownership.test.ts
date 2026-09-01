import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import {
  ADAPTER_API_VERSION,
  planSingleFileInstall,
  planSingleFileRemoval,
  planSkillBundleInstall,
  planSkillBundleRemoval,
} from '@agent-facets/adapter'
import type { CollisionResolution } from '../commit/compose.ts'
import { CURRENT_RECEIPT_VERSION, type Receipt, receiptPath, writeReceipt } from '../receipt.ts'
import { runInstall } from '../run-install.ts'
import type { StageEvent } from '../types.ts'

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

/** An adapter that plans real skill bundles and records every request. */
function recordingAdapter(opts: { failInstallOf?: ReadonlySet<string> } = {}): { adapter: Adapter; io: string[] } {
  const io: string[] = []
  const paths = (name: string) => ({
    root: skillRoot(name),
    primaryFile: join(skillRoot(name), 'SKILL.md'),
    boundary: base(),
  })
  return {
    io,
    adapter: {
      name: 'rec',
      apiVersion: ADAPTER_API_VERSION,
      mcpServers: false,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      assets: {
        async planInstall(request) {
          io.push(`install:${request.assetType}:${request.name}`)
          if (opts.failInstallOf?.has(request.name)) {
            return { ok: false, failure: { code: 'io-failed', path: request.name, message: 'simulated plan failure' } }
          }
          if (request.assetType === 'skill') {
            return planSkillBundleInstall(paths(request.name), {
              content: request.content,
              metadata: request.metadata as Record<string, unknown>,
              companions: request.companions,
              ownedCompanionPaths: request.ownedCompanionPaths,
            })
          }
          return planSingleFileInstall(
            { file: flatFile(request.assetType, request.name), boundary: base() },
            request.content,
            request.metadata as Record<string, unknown>,
          )
        },
        async planRemoval(request) {
          io.push(`delete:${request.assetType}:${request.name}`)
          if (request.assetType === 'skill') {
            return planSkillBundleRemoval(paths(request.name), request.ownedCompanionPaths)
          }
          return planSingleFileRemoval({ file: flatFile(request.assetType, request.name), boundary: base() })
        },
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
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const { adapter, io } = recordingAdapter()

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
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
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const { adapter } = recordingAdapter()

    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    const second = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!second.ok) expect.unreachable()

    // If the companion lookup keyed off the effective name, the bundle would
    // read as "companions missing" and be rewritten every single run.
    expect(second.summary.textAssets.written).toBe(0)
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
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(true)

    writeManifest({
      manifestVersion: 0.2,
      facets: { beta: { source: b, materialization: { skills: { other: { kind: 'aliased', as: 'review' } } } } },
    })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
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
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    mkdirSync(skillRoot('shared'), { recursive: true })
    mkdirSync(join(skillRoot('shared'), 'refs'), { recursive: true })
    writeFileSync(join(skillRoot('shared'), 'SKILL.md'), '# stale\n')
    writeFileSync(join(skillRoot('shared'), 'refs/one.md'), '# one\n')
    writeFileSync(join(skillRoot('shared'), 'refs/two.md'), '# two\n')

    const receipt = readReceipt()
    const claim = (_facet: string, companion: string): Receipt['facets'][string] => ({
      version: '1.0.0',
      integrity: 'sha256:ghost',
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'shared',
          materialization: { kind: 'authored' },
          files: ['skills/shared/SKILL.md', `skills/shared/${companion}`],
        },
      ],
      configurations: [],
    })
    writeReceipt(projectRoot, {
      version: CURRENT_RECEIPT_VERSION,
      path: projectRoot,
      facets: { ...receipt.facets, ghostA: claim('ghostA', 'refs/one.md'), ghostB: claim('ghostB', 'refs/two.md') },
    })

    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    // Exactly one delete for the shared identity.
    expect(io.filter((c) => c === 'delete:skill:shared')).toHaveLength(1)
    // Both claimants' companions were removed — the union, not just one set.
    expect(existsSync(skillRoot('shared'))).toBe(false)
    // Counted once, not once per claim.
    expect(result.summary.textAssets.removed).toBe(1)
  })

  test('changing an alias deletes the old identity and writes the new one', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const aliased = (as: string) => ({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as } } } } },
    })

    writeManifest(aliased('vendor-review'))
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(existsSync(join(skillRoot('vendor-review'), 'refs/api.md'))).toBe(true)

    writeManifest(aliased('partner-review'))
    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
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

  test('aliasing both claimants apart vacates the old identity and writes both aliases', async () => {
    // `alpha` is installed and materialized under its authored name. A second
    // facet then contributes the same authored name, and the accepted
    // resolution aliases BOTH claimants — so one operation has to delete an
    // identity a facet that is STAYING used to own, and create two new ones.
    // Every ingredient of this was covered in isolation; the combination is
    // where a per-facet or write-before-delete ordering silently loses content.
    const a = skillFixture('alpha', 'planner')
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(readFileSync(join(skillRoot('planner'), 'SKILL.md'), 'utf8')).toContain('# planner from alpha')

    const b = skillFixture('beta', 'planner')
    writeManifest({ facets: { alpha: a, beta: b } })

    io.length = 0
    let groups = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: {
        kind: 'reproduce',
        frozen: false,
        resolveCollisions: async (request): Promise<CollisionResolution> => {
          groups = request.groups.length
          // Intent is settled before anything moves on disk.
          expect(io).toEqual([])
          return {
            kind: 'resolved',
            overrides: {
              alpha: { skills: { planner: { kind: 'aliased', as: 'planner-a' } } },
              beta: { skills: { planner: { kind: 'aliased', as: 'planner-b' } } },
            },
          }
        },
      },
    })
    if (!result.ok) expect.unreachable()
    expect(groups).toBe(1)

    // The vacated identity is deleted before either alias is written.
    const vacated = io.indexOf('delete:skill:planner')
    expect(vacated).toBeGreaterThanOrEqual(0)
    expect(vacated).toBeLessThan(io.indexOf('install:skill:planner-a'))
    expect(vacated).toBeLessThan(io.indexOf('install:skill:planner-b'))
    expect(existsSync(skillRoot('planner'))).toBe(false)

    // Each alias holds its OWN facet's content — content is looked up by
    // authored name, and both facets author the same one.
    expect(readFileSync(join(skillRoot('planner-a'), 'SKILL.md'), 'utf8')).toContain('# planner from alpha')
    expect(readFileSync(join(skillRoot('planner-b'), 'SKILL.md'), 'utf8')).toContain('# planner from beta')

    // Both aliases are recorded, and no authored claim on `planner` survives —
    // a stale claim there would delete a file the next run just wrote.
    const receipt = readReceipt()
    expect(receipt.facets.alpha?.assets[0]?.materialization).toEqual({ kind: 'aliased', as: 'planner-a' })
    expect(receipt.facets.beta?.assets[0]?.materialization).toEqual({ kind: 'aliased', as: 'planner-b' })
    expect(receipt.facets.alpha?.assets[0]?.files).toEqual(['skills/planner/SKILL.md'])

    // The accepted intent is durable for both facets, not just the newcomer.
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    expect(manifest.facets.alpha.materialization).toEqual({ skills: { planner: { kind: 'aliased', as: 'planner-a' } } })
    expect(manifest.facets.beta.materialization).toEqual({ skills: { planner: { kind: 'aliased', as: 'planner-b' } } })

    // A disposition-only change at an unchanged version is an update; the
    // newcomer is an install.
    expect([...result.perFacet].sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { kind: 'updated', name: 'alpha', oldVersion: '1.0.0', newVersion: '1.0.0' },
      { kind: 'installed', name: 'beta', version: '1.0.0' },
    ])
  })

  test('omitting an installed asset removes its whole bundle, and un-omitting restores it', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(existsSync(join(skillRoot('review'), 'refs/api.md'))).toBe(true)

    writeManifest({
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { skills: { review: { kind: 'omitted' } } } } },
    })
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(existsSync(skillRoot('review'))).toBe(false)
    // Still locked — an omission is a materialization choice, not a removal.
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lock.facets.alpha.assets[0].materialization).toEqual({ kind: 'omitted' })
    expect(readReceipt().facets.alpha?.assets).toEqual([])

    writeManifest({ facets: { alpha: a } })
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
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
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [recordingAdapter().adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(existsSync(join(skillRoot('review'), 'refs/api.md'))).toBe(true)

    // Change beta's content so its write is not skipped as identical.
    writeFileSync(join(projectRoot, 'vendor/beta/skills/other/SKILL.md'), '# other v2\n')
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'omitted' } } } },
        beta: b,
      },
    })

    const { adapter, io } = recordingAdapter({ failInstallOf: new Set(['other']) })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ADAPTER_INSTALL_FAILED')
    expect(result.rollback.kind).toBe('complete')

    // Deletion preceded the failed write, and was undone.
    expect(io.indexOf('delete:skill:review')).toBeLessThan(io.indexOf('install:skill:other'))
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# review from alpha')
    expect(readFileSync(join(skillRoot('review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
  })

  test('rollback removes a companion the failed operation added', async () => {
    // The forward write replaced a bundle and added `refs/new.md`. Its undo
    // restores the prior bundle — and must also take the added companion with
    // it. An undo scoped to only the PREVIOUSLY owned paths leaves `new.md`
    // beside a restored bundle that never referenced it, and the failed
    // transaction writes no receipt, so nothing would ever be able to claim
    // or delete it again.
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [recordingAdapter().adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // alpha gains a companion; beta's write will fail after alpha's succeeds.
    writeFileSync(join(projectRoot, 'vendor/alpha/skills/review/refs/new.md'), '# new\n')
    writeFileSync(
      join(projectRoot, 'vendor/alpha/facet.json'),
      JSON.stringify({
        name: 'alpha',
        version: '1.0.0',
        skills: { review: { description: 'review of alpha', files: ['refs/api.md', 'refs/new.md'] } },
      }),
    )
    writeFileSync(join(projectRoot, 'vendor/beta/skills/other/SKILL.md'), '# other v2\n')

    const { adapter } = recordingAdapter({ failInstallOf: new Set(['other']) })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    expect(result.rollback.kind).toBe('complete')

    expect(existsSync(join(skillRoot('review'), 'refs/new.md'))).toBe(false)
    expect(readFileSync(join(skillRoot('review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# review from alpha')
  })

  test('rollback removes a freshly created bundle in full, companions included', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })

    const { adapter } = recordingAdapter({ failInstallOf: new Set(['other']) })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    expect(result.rollback.kind).toBe('complete')

    // Nothing this run created may survive it — the undo of a create is a
    // delete of everything it wrote, not just the primary.
    expect(existsSync(join(skillRoot('review'), 'refs/api.md'))).toBe(false)
    expect(existsSync(skillRoot('review'))).toBe(false)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('rollback of a repaired bundle whose primary was missing converges on absent', async () => {
    // The boundary case. The user deleted `SKILL.md` but left the owned
    // companion; the adapter's read reports the whole bundle `not-found`,
    // because a bundle is addressed through its primary. The repair therefore
    // records a CREATE, and undoing a create deletes the bundle — including
    // the companion that was on disk beforehand.
    //
    // That is not byte-identical restoration, and it is deliberate: the undo
    // converges on the state the adapter contract could actually witness, and
    // every file it removes is one the receipt already owned. Claiming more
    // would mean inventing a preimage nothing read.
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [recordingAdapter().adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    rmSync(join(skillRoot('review'), 'SKILL.md'))
    expect(existsSync(join(skillRoot('review'), 'refs/api.md'))).toBe(true)
    writeFileSync(join(projectRoot, 'vendor/beta/skills/other/SKILL.md'), '# other v2\n')

    const { adapter } = recordingAdapter({ failInstallOf: new Set(['other']) })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    expect(result.rollback.kind).toBe('complete')

    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(false)
    // Byte-exact restoration, not convergence: the companion the repair
    // deleted had an exact state of its own, so the rollback puts it back.
    // An earlier design could only converge on absent here, because the
    // bundle read was addressed through a primary that was already gone.
    expect(readFileSync(join(skillRoot('review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
  })

  test('an unreadable receipt path fails the commit and rolls materialization back', async () => {
    // A receipt path that cannot be read — here a directory where the file
    // belongs — used to escape `commitProjectFiles` as a throw, out of a
    // function documented never to throw, AFTER the write pass had already
    // run. The journal never replayed. It is an ordinary commit failure now.
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    mkdirSync(receiptPath(projectRoot), { recursive: true })

    const { adapter } = recordingAdapter()
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('LOCKFILE_WRITE_FAILED')
    expect(result.rollback.kind).toBe('complete')

    // The write pass ran and was undone; no project file was touched.
    expect(existsSync(skillRoot('review'))).toBe(false)
    expect(existsSync(join(projectRoot, 'facets.lock'))).toBe(false)
  })

  test('a file the receipt does not own survives cleanup', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // A user's own note inside the bundle directory.
    const note = join(skillRoot('review'), 'notes.txt')
    writeFileSync(note, 'mine\n')

    writeManifest({ facets: {} })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(false)
    expect(readFileSync(note, 'utf8')).toBe('mine\n')
  })

  test('an untracked file at a desired identity is overwritten and then tracked', async () => {
    // Desired state authorizes writes: an install converges the identity it
    // was asked for even when something unmanaged already occupies it.
    // Ownership is what the write CREATES, not a precondition for it.
    const a = skillFixture('alpha', 'review')
    mkdirSync(skillRoot('review'), { recursive: true })
    writeFileSync(join(skillRoot('review'), 'SKILL.md'), '# not ours\n')
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter()

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# review from alpha')
    // Recorded only now — which is what makes a later removal able to delete it.
    expect(readReceipt().facets.alpha?.assets[0]?.files).toEqual(['skills/review/SKILL.md'])
  })

  test('an untracked identity the desired set never names is left untouched', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // A bundle this machine never materialized, at an identity nothing claims.
    mkdirSync(skillRoot('handwritten'), { recursive: true })
    writeFileSync(join(skillRoot('handwritten'), 'SKILL.md'), '# mine\n')

    writeManifest({ facets: {} })
    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    // Cleanup is authorized by the receipt, so an unclaimed identity is not
    // even addressed — let alone deleted.
    expect(io.some((call) => call.endsWith(':handwritten'))).toBe(false)
    expect(readFileSync(join(skillRoot('handwritten'), 'SKILL.md'), 'utf8')).toBe('# mine\n')
    expect(existsSync(skillRoot('review'))).toBe(false)
  })

  test('removing a facet this machine never tracked deletes nothing from disk', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // The shape of a pulled lockfile on a machine that never ran the install:
    // the declaration exists in shared state, but nothing witnesses that THIS
    // machine put those bytes on disk. Removing the declaration must not be
    // read as permission to delete whatever currently sits at that identity.
    rmSync(receiptPath(projectRoot), { force: true })

    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'remove', removals: [{ facetName: 'alpha' }] },
    })
    if (!result.ok) expect.unreachable()

    // The project's records drop the facet...
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lock.facets.alpha).toBeUndefined()
    expect(readReceipt().facets.alpha).toBeUndefined()
    // ...and nothing on disk is touched, because nothing proved ownership.
    expect(io.some((call) => call.startsWith('delete:'))).toBe(false)
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# review from alpha')
    expect(result.summary.textAssets.removed).toBe(0)
    // Reported as its own outcome: "removed" would claim the files are gone.
    expect(result.perFacet).toEqual([{ kind: 'removed-untracked', name: 'alpha', oldVersion: '1.0.0' }])
    // Still counted as a removal — a declaration really did leave the project.
    expect(result.summary.facets.removed).toBe(1)
  })

  test('a tracked removal reports removed, not removed-untracked', async () => {
    // The control for the test above: same operation, receipt intact. Without
    // it, a bug that reported every removal as untracked would pass.
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'remove', removals: [{ facetName: 'alpha' }] },
    })
    if (!result.ok) expect.unreachable()

    expect(result.perFacet).toContainEqual({ kind: 'removed', name: 'alpha', oldVersion: '1.0.0' })
    expect(existsSync(skillRoot('review'))).toBe(false)
    expect(result.summary.textAssets.removed).toBe(1)
  })

  test('an obsolete bundle whose primary is gone still removes its owned companions', async () => {
    // The companions have exact states of their own, so removing them is a
    // transition that can be undone — which is what makes it safe. Retaining
    // them, as an earlier design had to, left untracked files behind for the
    // user to find and clean up by hand.
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    rmSync(join(skillRoot('review'), 'SKILL.md'))

    writeManifest({ facets: {} })
    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    expect(existsSync(join(skillRoot('review'), 'refs/api.md'))).toBe(false)
    const lock = JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
    expect(lock.facets.alpha).toBeUndefined()
    expect(readReceipt().facets.alpha).toBeUndefined()
  })

  test('a tracked removal reports removed, not removed-untracked', async () => {
    // The control for the test above: same operation, receipt intact. Without
    // it, a bug that reported every removal as untracked would pass.
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'remove', removals: [{ facetName: 'alpha' }] },
    })
    if (!result.ok) expect.unreachable()

    expect(result.perFacet).toContainEqual({ kind: 'removed', name: 'alpha', oldVersion: '1.0.0' })
    expect(existsSync(skillRoot('review'))).toBe(false)
    expect(result.summary.textAssets.removed).toBe(1)
  })

  test('a failure after an orphaned-companion delete restores the bytes it removed', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    const before = {
      lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'),
      receipt: readFileSync(receiptPath(projectRoot), 'utf8'),
    }

    rmSync(join(skillRoot('review'), 'SKILL.md'))
    // A directory where the receipt belongs, so the commit is refused after
    // the delete pass has already run.
    rmSync(receiptPath(projectRoot))
    mkdirSync(receiptPath(projectRoot), { recursive: true })

    writeManifest({ facets: {} })
    const events: StageEvent[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      onStage: (e) => events.push(e),
      operation: { kind: 'reproduce', frozen: false },
    })
    if (result.ok) expect.unreachable()

    // The companion WAS deleted, and putting it back is exactly what having
    // its exact prior bytes buys: the removal never committed, so the file is
    // still tracked and must still be there.
    expect(result.rollback.kind).toBe('complete')
    expect(readFileSync(join(skillRoot('review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(before.lock)
    expect(events.length).toBeGreaterThan(0)
  })

  test.each([
    ['corrupt', 'not json{'],
    ['path-mismatch', JSON.stringify({ version: CURRENT_RECEIPT_VERSION, path: '/nowhere/else', facets: {} })],
  ] as const)('a %s receipt authorizes no deletion and is reported', async (reason, body) => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // A receipt file that exists and cannot be used. Every identity it had
    // tracked is now untracked, so an install that drops the facet must not
    // delete anything — and the user has to be told, because the consequence
    // outlives the command.
    writeFileSync(receiptPath(projectRoot), body)

    writeManifest({ facets: {} })
    io.length = 0
    const events: StageEvent[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      onStage: (e) => events.push(e),
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()

    expect(events).toContainEqual({ kind: 'receipt-unavailable', reason })
    expect(io.some((call) => call.startsWith('delete:'))).toBe(false)
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# review from alpha')
    expect(result.perFacet).toEqual([{ kind: 'removed-untracked', name: 'alpha', oldVersion: '1.0.0' }])
    // The unusable document is replaced by a record of what this run wrote.
    expect(readReceipt().facets).toEqual({})
  })

  test('a missing receipt is not reported as an anomaly', async () => {
    // First install on a project. Nothing is wrong, so nothing is warned about.
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter } = recordingAdapter()
    const events: StageEvent[] = []

    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          onStage: (e) => events.push(e),
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    expect(events.some((e) => e.kind === 'receipt-unavailable')).toBe(false)
  })

  test('an install after an unusable receipt re-establishes ownership it can then delete', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    writeFileSync(receiptPath(projectRoot), 'not json{')

    // The remedy the CLI points at: install while the source is reachable. The
    // write is what re-creates the claim...
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(readReceipt().facets.alpha?.assets.map((asset) => asset.name)).toEqual(['review'])

    // ...and only now can a removal delete it.
    writeManifest({ facets: {} })
    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
    if (!result.ok) expect.unreachable()
    expect(io).toContain('delete:skill:review')
    expect(existsSync(skillRoot('review'))).toBe(false)
    expect(result.perFacet).toEqual([{ kind: 'removed', name: 'alpha', oldVersion: '1.0.0' }])
  })

  test('an aliased asset is removed offline from the receipt alone', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // Delete the source tree entirely: removal must not need to resolve or
    // rebuild anything. The receipt's recorded disposition is the only thing
    // that knows the bundle is at `vendor-review` rather than `review`.
    rmSync(join(projectRoot, 'vendor'), { recursive: true, force: true })
    writeManifest({ facets: {} })

    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: false },
    })
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
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    return { adapter, lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'), manifestText }
  }

  function expectUntouched(lock: string, manifestText: string): void {
    expect(readFileSync(join(projectRoot, 'facets.lock'), 'utf8')).toBe(lock)
    expect(readFileSync(join(projectRoot, 'facets.json'), 'utf8')).toBe(manifestText)
  }

  test('recorded dispositions reproduce without prompting or rewriting', async () => {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const { adapter, lock } = await seed({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const manifestText = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    // No resolver is supplied because a frozen operation cannot carry one:
    // reproducing recorded intent must never collect a new decision, and the
    // type now says so instead of the runtime quietly ignoring it.
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
    if (!result.ok) expect.unreachable()
    expect(result.summary.textAssets.written).toBe(0)
    expect(existsSync(join(skillRoot('vendor-review'), 'refs/api.md'))).toBe(true)
    expectUntouched(lock, manifestText)
  })

  test('an alias the lockfile does not record is drift, not a silent re-materialization', async () => {
    const a = skillFixture('alpha', 'review')
    const { adapter, lock } = await seed({ facets: { alpha: a } })

    const manifestText = writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
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
      manifestVersion: 0.2,
      facets: { alpha: { source: a, materialization: { skills: { gone: { kind: 'omitted' } } } } },
    })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'LOCKFILE_DRIFT') expect.unreachable()
    const entry = result.failure.facets[0]
    if (entry?.reason !== 'stale-override') expect.unreachable()
    expect(entry.authoredName).toBe('gone')
    // A normal install prunes this; frozen mode must leave it exactly alone.
    expectUntouched(lock, manifestText)
  })

  test('a receipt it cannot write is reported, and the reproduction still succeeds', async () => {
    // Frozen mode has no locked set to roll back — the manifest and lockfile
    // it reproduced are correct and untouched — so a receipt it cannot
    // persist does not fail the operation. It does have to be SAID: every
    // asset this run put on disk is untracked from here on, and nothing about
    // a silent success would let a user work that out.
    const a = skillFixture('alpha', 'review')
    const { adapter, lock } = await seed({ facets: { alpha: a } })
    const manifestText = readFileSync(join(projectRoot, 'facets.json'), 'utf8')

    // A directory where the receipt file belongs: readable as nothing,
    // writable as nothing.
    rmSync(receiptPath(projectRoot), { force: true })
    mkdirSync(receiptPath(projectRoot), { recursive: true })
    rmSync(skillRoot('review'), { recursive: true, force: true })

    const events: StageEvent[] = []
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      onStage: (event) => events.push(event),
      operation: { kind: 'reproduce', frozen: true },
    })
    if (!result.ok) expect.unreachable()

    // The repair happened; the locked set is untouched; the loss is reported.
    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(true)
    expectUntouched(lock, manifestText)
    const reported = events.find((event) => event.kind === 'receipt-unpersisted')
    if (reported?.kind !== 'receipt-unpersisted') expect.unreachable()
    // Nothing was written here, so there is nothing left behind to name.
    expect(reported.residue.kind).toBe('complete')
  })

  test('a collision in recorded state fails before anything is resolved', async () => {
    // Two facets whose locked assets collide once the manifest's alias is
    // applied. Coverage is fine — both are locked — so this reaches the
    // materialization planner, which is the check under test.
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other')
    const { adapter, lock } = await seed({ facets: { alpha: a, beta: b } })

    const manifestText = writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: a,
        beta: { source: b, materialization: { skills: { other: { kind: 'aliased', as: 'review' } } } },
      },
    })
    // Delete the sources. If the gate ran after resolution, this would fail
    // with a resolve error instead — so reaching a collision report proves the
    // check happened before anything was fetched, cloned, or built.
    rmSync(join(projectRoot, 'vendor'), { recursive: true, force: true })

    // No resolver is supplied because a frozen operation cannot carry one:
    // reproducing recorded intent must never collect a new decision, and the
    // type now says so instead of the runtime quietly ignoring it.
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
    if (result.ok) expect.unreachable()
    // Coverage is fine, so this must be the collision report — with every
    // claimant named, exactly as a non-interactive install would get it.
    if (result.failure.code !== 'MATERIALIZATION_COLLISION') expect.unreachable()
    expect(result.failure.groups).toHaveLength(1)
    expect(result.failure.groups[0]?.group.members.map((m) => m.facet).sort()).toEqual(['alpha', 'beta'])
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
      manifestVersion: 0.2,
      facets: {
        alpha: { source: a, materialization: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } },
      },
    })
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
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

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
    if (!result.ok) expect.unreachable()
    expectUntouched(lock, manifestText)
  })

  test('a frozen add is refused before the lockfile is even read', async () => {
    const a = skillFixture('alpha', 'review')
    writeManifest({ facets: { alpha: a } })
    // A lockfile that cannot be parsed at all. A frozen run still has to
    // report the file it genuinely cannot read; what it no longer has to
    // report is "you asked to add something while frozen", because that
    // request is not constructible. See `install-operation.test.ts`.
    writeFileSync(join(projectRoot, 'facets.lock'), '{ not json')
    const { adapter } = recordingAdapter()

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'reproduce', frozen: true },
    })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('LOCKFILE_INVALID')
    expect(result.rollback.kind).toBe('not-needed')
  })
})

/**
 * The removal-only refinement path, where nothing is written.
 *
 * That is safe exactly when the receipt already agrees about every remaining
 * asset. When it does not, refining would commit a receipt describing files
 * this machine does not have — and because ownership reconciliation trusts
 * the receipt, the real file becomes unreachable forever. Each case below
 * must therefore fall back to the ordinary pipeline, which puts the remaining
 * facet's bytes where the record says they are.
 */
describe('remove — refinement only when local state agrees', () => {
  function readLock(): { lockfileVersion: number; facets: Record<string, Record<string, unknown>> } {
    return JSON.parse(readFileSync(join(projectRoot, 'facets.lock'), 'utf8'))
  }

  function writeLock(lock: unknown): void {
    writeFileSync(join(projectRoot, 'facets.lock'), `${JSON.stringify(lock, null, 2)}\n`)
  }

  /** Record an alias in the lockfile without materializing it — a pulled edit. */
  function recordAliasInLockfile(facet: string, authoredName: string, as: string): void {
    const lock = readLock()
    const entry = lock.facets[facet]
    if (entry === undefined) expect.unreachable()
    for (const asset of entry.assets as Array<Record<string, unknown>>) {
      if (asset.name === authoredName) asset.materialization = { kind: 'aliased', as }
    }
    writeLock(lock)
  }

  async function removeAlpha(adapter: Adapter) {
    return await runInstall({
      projectRoot,
      adapters: [adapter],
      operation: { kind: 'remove', removals: [{ facetName: 'alpha' }] },
    })
  }

  test('a remaining alias this machine never wrote is materialized, not just recorded', async () => {
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)

    // A teammate aliased `beta`'s skill and committed both files. This machine
    // pulled them but never ran an install, so `skills/other/` is still what
    // is actually on disk.
    recordAliasInLockfile('beta', 'other', 'vendor-other')
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: a,
        beta: { source: b, materialization: { skills: { other: { kind: 'aliased', as: 'vendor-other' } } } },
      },
    })

    io.length = 0
    const result = await removeAlpha(adapter)
    if (!result.ok) expect.unreachable()

    // The write pass ran: refinement would have committed the alias while
    // leaving the authored bundle on disk, unclaimed and undeletable.
    expect(io).toContain('install:skill:vendor-other')
    expect(readFileSync(join(skillRoot('vendor-other'), 'SKILL.md'), 'utf8')).toContain('# other from beta')
    expect(existsSync(skillRoot('other'))).toBe(false)

    const receipt = readReceipt()
    expect(receipt.facets.alpha).toBeUndefined()
    expect(receipt.facets.beta?.assets[0]?.materialization).toEqual({ kind: 'aliased', as: 'vendor-other' })
  })

  test('an identity a removed facet also claimed gets the remaining content', async () => {
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# review from alpha')

    // `beta` now claims exactly the name `alpha` materialized. The bytes at
    // that identity are alpha's, and alpha is the facet being removed.
    recordAliasInLockfile('beta', 'other', 'review')
    writeManifest({
      manifestVersion: 0.2,
      facets: {
        alpha: a,
        beta: { source: b, materialization: { skills: { other: { kind: 'aliased', as: 'review' } } } },
      },
    })

    io.length = 0
    const result = await removeAlpha(adapter)
    if (!result.ok) expect.unreachable()

    // Refining would have kept the identity (a remaining facet claims it), written
    // nothing, and committed a receipt attributing alpha's bytes to beta.
    expect(io).toContain('install:skill:review')
    expect(readFileSync(join(skillRoot('review'), 'SKILL.md'), 'utf8')).toContain('# other from beta')
    expect(readReceipt().facets.alpha).toBeUndefined()
  })

  test('an uncontested, witnessed removal still writes nothing', async () => {
    const a = skillFixture('alpha', 'review')
    const b = skillFixture('beta', 'other', { companions: { 'refs/api.md': '# api\n' } })
    writeManifest({ facets: { alpha: a, beta: b } })
    const { adapter, io } = recordingAdapter()
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
    const remainingBefore = readFileSync(join(skillRoot('other'), 'refs/api.md'), 'utf8')

    io.length = 0
    const result = await removeAlpha(adapter)
    if (!result.ok) expect.unreachable()

    // The offline guarantee: only the removed identity is touched at all, and
    // nothing is written. (The read is the delete pass snapshotting it for
    // rollback.)
    expect(io).toEqual(['delete:skill:review'])
    expect(readFileSync(join(skillRoot('other'), 'refs/api.md'), 'utf8')).toBe(remainingBefore)
    expect(existsSync(skillRoot('review'))).toBe(false)
    expect(readReceipt().facets.beta?.assets[0]?.files).toEqual(['skills/other/SKILL.md', 'skills/other/refs/api.md'])
  })
})

/**
 * Cancellation on the refined removal path.
 *
 * `RunInstallOptions.signal` promises to stop at the next safe checkpoint and
 * roll back. This branch accepted the signal and never read it, so Ctrl-C
 * still deleted assets and committed the manifest, lockfile, and receipt.
 */
describe('remove — cancellation on the refined path', () => {
  function projectFiles(): { manifest: string; lock: string } {
    return {
      manifest: readFileSync(join(projectRoot, 'facets.json'), 'utf8'),
      lock: readFileSync(join(projectRoot, 'facets.lock'), 'utf8'),
    }
  }

  async function seedTwoFacets(adapter: Adapter): Promise<void> {
    const a = skillFixture('alpha', 'review', { companions: { 'refs/api.md': '# api\n' } })
    const b = skillFixture('beta', 'other')
    writeManifest({ facets: { alpha: a, beta: b } })
    expect(
      (
        await runInstall({
          projectRoot,
          adapters: [adapter],
          operation: { kind: 'reproduce', frozen: false },
        })
      ).ok,
    ).toBe(true)
  }

  test('a pre-aborted removal deletes nothing and reports no mutation', async () => {
    const { adapter, io } = recordingAdapter()
    await seedTwoFacets(adapter)
    const before = projectFiles()
    const controller = new AbortController()
    controller.abort()

    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      signal: controller.signal,
      operation: { kind: 'remove', removals: [{ facetName: 'alpha' }] },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ABORTED')
    // Nothing was written, so the CLI must not tell the user anything was
    // restored — that distinction comes from here, not from the code.
    expect(result.rollback.kind).toBe('not-needed')
    expect(io).toEqual([])
    expect(existsSync(join(skillRoot('review'), 'SKILL.md'))).toBe(true)
    expect(projectFiles()).toEqual(before)
    expect(readReceipt().facets.alpha).toBeDefined()
  })

  test('an abort during the delete pass rolls the deleted bundle back', async () => {
    const { adapter, io } = recordingAdapter()
    await seedTwoFacets(adapter)
    const before = projectFiles()
    const controller = new AbortController()

    // Ctrl-C lands while the delete pass is running: the delete succeeds, and
    // the checkpoint after it is what turns that into a rollback instead of a
    // commit.
    const capability = adapter.assets
    if (capability === false) expect.unreachable()
    const abortingAdapter: Adapter = {
      ...adapter,
      assets: {
        ...capability,
        planRemoval: async (request) => {
          const result = await capability.planRemoval(request)
          controller.abort()
          return result
        },
      },
    }

    io.length = 0
    const result = await runInstall({
      projectRoot,
      adapters: [abortingAdapter],
      signal: controller.signal,
      operation: { kind: 'remove', removals: [{ facetName: 'alpha' }] },
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('ABORTED')
    if (result.rollback.kind !== 'complete') expect.unreachable()
    expect(result.rollback.restored.length).toBeGreaterThan(0)

    // The bundle the delete pass removed is back, companion included, and the
    // project files were never committed.
    expect(readFileSync(join(skillRoot('review'), 'refs/api.md'), 'utf8')).toBe('# api\n')
    expect(projectFiles()).toEqual(before)
    expect(readReceipt().facets.alpha).toBeDefined()
  })

  test('an un-aborted removal on the same path still commits', async () => {
    const { adapter } = recordingAdapter()
    await seedTwoFacets(adapter)
    const controller = new AbortController()

    const result = await runInstall({
      projectRoot,
      adapters: [adapter],
      signal: controller.signal,
      operation: { kind: 'remove', removals: [{ facetName: 'alpha' }] },
    })

    if (!result.ok) expect.unreachable()
    expect(existsSync(skillRoot('review'))).toBe(false)
    expect(readReceipt().facets.alpha).toBeUndefined()
  })
})
