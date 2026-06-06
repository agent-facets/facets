import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Lockfile } from '@agent-facets/protocol'
import { computeContentHash, LOCKFILE_VERSION } from '@agent-facets/protocol'

let projectRoot: string
let clonedSourceDir: string
let cloneCalls: Array<{ url: string; commitish: string | undefined }> = []

const clonedCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

mock.module('../../sources/facet/resolve-git.ts', () => ({
  cloneFacetGitSource: async (url: string, commitish?: string) => {
    cloneCalls.push({ url, commitish })
    return { ok: true, dir: clonedSourceDir, commit: clonedCommit }
  },
}))

const { planFacet } = await import('../plan-facet.ts')

function buildClonedFixture(name: string, version: string): string {
  const dir = realpathSync(mkdtempSync(join(projectRoot, 'cloned-git-')))
  writeFileSync(
    join(dir, 'facet.json'),
    JSON.stringify({
      name,
      version,
      skills: { planning: { description: 'planning skill' } },
    }),
  )
  mkdirSync(join(dir, 'skills/planning'), { recursive: true })
  writeFileSync(join(dir, 'skills/planning/SKILL.md'), `# planning ${version}\n`)
  return dir
}

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'plan-facet-test-')))
  clonedSourceDir = buildClonedFixture('viper-plans', '0.2.0')
  cloneCalls = []
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
  mock.restore()
})

describe('planFacet — changed git source', () => {
  test('treats the old git lock entry as absent after source-string drift', async () => {
    const oldIntegrity = computeContentHash('old-source')
    const previousLockfile: Lockfile = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: 'https://github.com/example/old.git#stable',
          ref: 'stable',
          commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          version: '0.1.0',
          integrity: oldIntegrity,
          assets: [{ scope: 'project', type: 'skill', name: 'planning' }],
        },
      },
    }

    const result = await planFacet({
      facetName: 'viper-plans',
      specifier: 'https://github.com/example/new.git#main',
      projectRoot,
      adapters: [],
      previousLockfile,
      onStage: () => {},
      onLog: () => {},
    })

    expect(cloneCalls).toEqual([{ url: 'https://github.com/example/new.git', commitish: 'main' }])
    if (!result.ok) expect.unreachable()
    expect(result.value.entry).toMatchObject({
      source: 'https://github.com/example/new.git#main',
      ref: 'main',
      commit: clonedCommit,
      version: '0.2.0',
    })
    expect(result.value.entry.integrity).not.toBe(oldIntegrity)
  })
})
