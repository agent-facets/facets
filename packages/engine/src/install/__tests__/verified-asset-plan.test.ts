import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authoredCompanionKey, readSkillCompanionBytes, type VerifiedAssetPlan } from '../verified-asset-plan.ts'

let verifiedDir: string

beforeEach(() => {
  verifiedDir = realpathSync(mkdtempSync(join(tmpdir(), 'facet-companion-')))
})

afterEach(() => {
  rmSync(verifiedDir, { recursive: true, force: true })
})

function planFor(files: string[]): VerifiedAssetPlan {
  return {
    assets: [
      {
        scope: 'project',
        type: 'skill',
        name: 'review',
        files: files.map((path) => ({ path, integrity: 'sha256:test' })),
      },
    ],
    archiveOnly: [],
  }
}

describe('readSkillCompanionBytes', () => {
  test('reads companions verbatim, keyed skill-root-relative', () => {
    mkdirSync(join(verifiedDir, 'skills/review/refs'), { recursive: true })
    writeFileSync(join(verifiedDir, 'skills/review/SKILL.md'), '# review\n')
    writeFileSync(join(verifiedDir, 'skills/review/refs/api.md'), '# api\n')

    const result = readSkillCompanionBytes(
      planFor(['skills/review/SKILL.md', 'skills/review/refs/api.md']),
      verifiedDir,
    )
    if (!result.ok) expect.unreachable()

    const companions = result.companions.get(authoredCompanionKey('project', 'skill', 'review'))
    expect(Object.keys(companions ?? {})).toEqual(['refs/api.md'])
    expect(new TextDecoder().decode(companions?.['refs/api.md'])).toBe('# api\n')
  })

  test('a companion that cannot be read is a failure, not a throw', () => {
    // The plan hashed this file moments ago; the directory is an ordinary one
    // that another process can still change underneath a running install.
    mkdirSync(join(verifiedDir, 'skills/review'), { recursive: true })
    writeFileSync(join(verifiedDir, 'skills/review/SKILL.md'), '# review\n')

    const result = readSkillCompanionBytes(
      planFor(['skills/review/SKILL.md', 'skills/review/refs/gone.md']),
      verifiedDir,
    )
    if (result.ok) expect.unreachable()
    expect(result.errors[0]?.path).toBe('skills/review/refs/gone.md')
    expect(result.errors[0]?.message).toContain('could not be read')
  })
})
