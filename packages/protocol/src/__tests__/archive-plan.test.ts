import { describe, expect, test } from 'bun:test'
import { type ArchivePlanError, type ArchivePlanInput, planArchiveEntries } from '@agent-facets/protocol'

function planErrors(manifest: ArchivePlanInput): ArchivePlanError[] {
  const result = planArchiveEntries(manifest)
  if (result.ok) expect.unreachable()
  return result.errors
}

function expectCode(manifest: ArchivePlanInput, code: ArchivePlanError['code']) {
  const errors = planErrors(manifest)
  expect(errors.map((e) => e.code)).toContain(code)
}

describe('planArchiveEntries — legal plans', () => {
  test('asset-only manifest plans manifest + conventional primary paths, sorted', () => {
    const result = planArchiveEntries({
      skills: { review: {} },
      agents: { reviewer: {} },
      commands: { ship: {} },
    })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual([
      { kind: 'primary-asset', path: 'agents/reviewer.md', assetType: 'agent', name: 'reviewer' },
      { kind: 'primary-asset', path: 'commands/ship.md', assetType: 'command', name: 'ship' },
      { kind: 'manifest', path: 'facet.json' },
      { kind: 'primary-asset', path: 'skills/review/SKILL.md', assetType: 'skill', name: 'review' },
    ])
  })

  test('skill companions and top-level files are classified and resolved', () => {
    const result = planArchiveEntries({
      skills: { review: { files: ['references/api.md', 'scripts/run.ts'] } },
      files: ['README.md', 'docs/notes.md'],
    })
    if (!result.ok) expect.unreachable()
    expect(result.data).toEqual([
      { kind: 'archive-only', path: 'README.md' },
      { kind: 'archive-only', path: 'docs/notes.md' },
      { kind: 'manifest', path: 'facet.json' },
      { kind: 'primary-asset', path: 'skills/review/SKILL.md', assetType: 'skill', name: 'review' },
      { kind: 'skill-companion', path: 'skills/review/references/api.md', skill: 'review' },
      { kind: 'skill-companion', path: 'skills/review/scripts/run.ts', skill: 'review' },
    ])
  })

  test('basename facet.json is permitted below another directory', () => {
    const result = planArchiveEntries({
      skills: { example: { files: ['examples/facet.json'] } },
      files: ['fixtures/facet.json'],
    })
    expect(result.ok).toBe(true)
  })

  test('names owned by the outer archive may appear as inner supplementary paths', () => {
    const result = planArchiveEntries({
      agents: { a: {} },
      files: ['build-manifest.json', 'archive.tar.gz'],
    })
    expect(result.ok).toBe(true)
  })

  test('empty files arrays are legal', () => {
    const result = planArchiveEntries({ skills: { review: { files: [] } }, files: [] })
    expect(result.ok).toBe(true)
  })
})

describe('planArchiveEntries — per-path grammar failures', () => {
  const base: ArchivePlanInput = { agents: { a: {} } }

  test.each([
    ['../secret', 'path-traversal'],
    ['docs/../secret', 'path-traversal'],
    ['/absolute', 'path-absolute'],
    ['C:/secret', 'path-absolute'],
    ['file://etc/passwd', 'path-absolute'],
    ['docs\\guide.md', 'path-backslash'],
    ['docs/\u0000name', 'path-control-byte'],
    ['docs/\u0007bell', 'path-control-byte'],
    ['docs//guide.md', 'path-empty-segment'],
    ['./docs/guide.md', 'path-empty-segment'],
    ['docs/./guide.md', 'path-empty-segment'],
    ['docs/', 'path-empty-segment'],
    ['notes:draft.md', 'path-forbidden-character'],
    ['what?.md', 'path-forbidden-character'],
    ['a<b.md', 'path-forbidden-character'],
    ['a|b.md', 'path-forbidden-character'],
    ['references/con', 'path-reserved-device-name'],
    ['aux.txt', 'path-reserved-device-name'],
    ['docs/COM1.md', 'path-reserved-device-name'],
    ['docs/LpT9', 'path-reserved-device-name'],
    ['report.', 'path-trailing-dot-or-space'],
    ['draft ', 'path-trailing-dot-or-space'],
    ['dir. /file.md', 'path-trailing-dot-or-space'],
  ] as const)('top-level %j fails with %s', (path, code) => {
    expectCode({ ...base, files: [path] }, code)
  })

  test('empty declared path fails', () => {
    expectCode({ ...base, files: [''] }, 'path-empty')
  })

  test('per-skill companion paths run the same grammar', () => {
    expectCode({ skills: { review: { files: ['../escape.md'] } } }, 'path-traversal')
    expectCode({ skills: { review: { files: ['refs\\a.md'] } } }, 'path-backslash')
    expectCode({ skills: { review: { files: ['refs/aux'] } } }, 'path-reserved-device-name')
  })

  test('errors carry the declaration site', () => {
    const errors = planErrors({ skills: { review: { files: ['../up'] } } })
    expect(errors[0]?.path).toBe('skills.review.files')
    const topErrors = planErrors({ agents: { a: {} }, files: ['../up'] })
    expect(topErrors[0]?.path).toBe('files')
  })
})

describe('planArchiveEntries — declaration-site rules', () => {
  test('top-level path under skills/ is redirected to the owning skill', () => {
    const errors = planErrors({
      skills: { review: {} },
      files: ['skills/review/references/api.md'],
    })
    expect(errors.map((e) => e.code)).toContain('site-top-level-under-skills')
  })

  test('skill companion SKILL.md is rejected', () => {
    expectCode({ skills: { review: { files: ['SKILL.md'] } } }, 'site-skill-companion-is-primary')
  })

  test('root facet.json declaration is rejected', () => {
    expectCode({ agents: { a: {} }, files: ['facet.json'] }, 'reserved-root-manifest')
  })
})

describe('planArchiveEntries — collision failures', () => {
  test('exact duplicate supplementary paths', () => {
    expectCode({ agents: { a: {} }, files: ['docs/guide.md', 'docs/guide.md'] }, 'collision-duplicate')
  })

  test('portable case-fold alias', () => {
    expectCode({ agents: { a: {} }, files: ['Docs/guide.md', 'docs/guide.md'] }, 'collision-case-fold')
  })

  test('Unicode normalization alias (NFC vs NFD)', () => {
    expectCode({ agents: { a: {} }, files: ['docs/caf\u00e9.md', 'docs/cafe\u0301.md'] }, 'collision-unicode-alias')
  })

  test('file/directory prefix conflict', () => {
    expectCode({ agents: { a: {} }, files: ['docs', 'docs/guide.md'] }, 'collision-prefix')
  })

  test('supplementary path colliding with a conventional primary path', () => {
    expectCode({ agents: { reviewer: {} }, files: ['agents/reviewer.md'] }, 'collision-primary-path')
  })

  test('case-fold collision with a primary path is a primary-path collision', () => {
    expectCode({ agents: { reviewer: {} }, files: ['agents/Reviewer.md'] }, 'collision-primary-path')
  })

  test('skill companion colliding with its own primary via case fold', () => {
    expectCode({ skills: { review: { files: ['skill.md'] } } }, 'collision-primary-path')
  })

  test('companion duplicated across two declaration entries', () => {
    expectCode({ skills: { review: { files: ['refs/a.md', 'refs/a.md'] } } }, 'collision-duplicate')
  })
})
