import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cachePath, cacheSlotIsDir, readCachedIntegrity } from '../../../cache/index.ts'
import { resolveGitFacet } from '../resolve-git.ts'

/**
 * Cold-cache git resolution against a real local repository.
 *
 * The whole point of this suite is that NOTHING is stubbed on the path
 * under test: a genuine `git clone` (over `file://`, so it runs offline
 * with no network or auth), a genuine build, and a genuine verified cache
 * put. That combination is what a user's first install of a git facet
 * does, and it is the one path where a build-manifest-shape mismatch
 * between the producer and the cache write surfaces.
 */

const FACET_NAME = 'viper-plans'
const FACET_VERSION = '0.1.0'
const SKILL_BODY = '# planning\n'
const README_BODY = '# viper-plans\n'

let fixtureRepo: string
let initialCommit: string
let facetDir: string
let originalFacetDir: string | undefined

function git(args: string[], cwd?: string): { stdout: string; ok: boolean } {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { stdout: result.stdout.toString().trim(), ok: result.exitCode === 0 }
}

beforeAll(() => {
  fixtureRepo = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-git-commit-fixture-')))
  // A README declared in `files` makes the fixture exercise the COMPLETE
  // `0.2` hash map: an archive-only supplementary entry that no asset owns,
  // so a primary-asset-only subset would be visibly short in the sidecar.
  writeFileSync(
    join(fixtureRepo, 'facet.json'),
    JSON.stringify({
      name: FACET_NAME,
      version: FACET_VERSION,
      files: ['README.md'],
      skills: { planning: { description: 'planning skill' } },
    }),
  )
  writeFileSync(join(fixtureRepo, 'README.md'), README_BODY)
  mkdirSync(join(fixtureRepo, 'skills/planning'), { recursive: true })
  writeFileSync(join(fixtureRepo, 'skills/planning/SKILL.md'), SKILL_BODY)

  git(['init', '-q', '-b', 'main'], fixtureRepo)
  git(['config', 'user.email', 'test@example.com'], fixtureRepo)
  git(['config', 'user.name', 'Test'], fixtureRepo)
  git(['add', '.'], fixtureRepo)
  git(['commit', '-q', '-m', 'initial'], fixtureRepo)
  initialCommit = git(['rev-parse', 'HEAD'], fixtureRepo).stdout
})

afterAll(() => {
  rmSync(fixtureRepo, { recursive: true, force: true })
})

beforeEach(() => {
  // A fresh, EMPTY facet dir per test: the cache slot this suite asserts on
  // can only exist because the resolver created it during the run.
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'resolve-git-commit-facetdir-')))
  originalFacetDir = process.env.FACET_DIR
  process.env.FACET_DIR = facetDir
})

afterEach(() => {
  if (originalFacetDir === undefined) {
    delete process.env.FACET_DIR
  } else {
    process.env.FACET_DIR = originalFacetDir
  }
  rmSync(facetDir, { recursive: true, force: true })
})

async function resolveFixture() {
  return resolveGitFacet({
    facetName: FACET_NAME,
    // `file://` keeps the clone offline. `parseFacetSource` would read a
    // bare path as a local source, so the git arm is constructed from the
    // URL form the parser does classify as git.
    source: { kind: 'git', url: `file://${fixtureRepo}` },
    adapters: [],
    effectiveLocked: undefined,
    onStage: () => {},
    onLog: () => {},
  })
}

describe('resolveGitFacet — cold cache, current-format build', () => {
  test('clones, builds, and commits a fresh git facet to the cache', async () => {
    const result = await resolveFixture()

    if (!result.ok) expect.unreachable()
    expect(result.value.version).toBe(FACET_VERSION)
    expect(result.value.integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
    // Provenance for a fresh clone is the URL plus the commit git resolved.
    expect(result.value.source).toEqual({
      kind: 'git',
      url: `file://${fixtureRepo}`,
      commit: initialCommit,
    })
  })

  test('derives the asset plan from the cached content', async () => {
    const result = await resolveFixture()

    if (!result.ok) expect.unreachable()
    expect(result.value.plan.assets).toEqual([
      {
        scope: 'project',
        type: 'skill',
        name: 'planning',
        files: [{ path: 'skills/planning/SKILL.md', integrity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) }],
      },
    ])
    expect(result.value.plan.archiveOnly.map((entry) => entry.path)).toEqual(['README.md'])
  })

  test('writes the durable cache slot and a sidecar covering every archive entry', async () => {
    const result = await resolveFixture()

    if (!result.ok) expect.unreachable()
    const slotPath = cachePath({ kind: 'git', name: FACET_NAME, version: FACET_VERSION })
    expect(cacheSlotIsDir({ kind: 'git', name: FACET_NAME, version: FACET_VERSION })).toBe(true)

    const sidecar = readCachedIntegrity(slotPath)
    if (sidecar === null) expect.unreachable()
    // The sidecar's top-level hash is the integrity the resolution is
    // anchored to — the same value a later audited hit compares against.
    expect(sidecar.integrity).toBe(result.value.integrity)
    // Every inner-archive entry is audited and recorded, not just the
    // primary asset: the embedded manifest and the archive-only README too.
    expect(Object.keys(sidecar.assets).sort()).toEqual(['README.md', 'facet.json', 'skills/planning/SKILL.md'])
  })
})
