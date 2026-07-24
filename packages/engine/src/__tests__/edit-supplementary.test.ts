import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FacetManifest } from '@agent-facets/protocol'
import { buildEditContext } from '../edit/context.ts'
import { addSkillCompanion, addTopLevelFile, removeSkillCompanion, removeTopLevelFile } from '../edit/declarations.ts'
import { previewEditOperations } from '../edit/operation-preview.ts'
import { applyEditOperations } from '../edit/operations.ts'
import {
  applyReadmeDeclaration,
  README_CREATE_DEFAULT,
  readmeActionFor,
  readmeActionOptions,
  readmeFileOperations,
  readmeOptionKindFor,
} from '../edit/readme-actions.ts'
import { computeReadmeStates } from '../edit/readme-state.ts'
import { reconcileSupplementary } from '../edit/reconcile-supplementary.ts'
import { scanCommonRootFiles, scanSkillCompanions } from '../edit/scanner.ts'
import type { EditOperation } from '../edit/types.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'facet-edit-supp-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function writeFile(rel: string, content = 'x'): Promise<void> {
  await mkdir(join(dir, rel, '..'), { recursive: true })
  await Bun.write(join(dir, rel), content)
}

// --- Scanner ---

describe('scanSkillCompanions', () => {
  test('lists nested companions and excludes SKILL.md', async () => {
    await writeFile('skills/review/SKILL.md', '# Review')
    await writeFile('skills/review/references/api.md', '# API')
    await writeFile('skills/review/scripts/run.ts', 'run')
    const companions = await scanSkillCompanions(dir, 'review')
    expect(companions).toEqual(['references/api.md', 'scripts/run.ts'])
  })
})

describe('scanCommonRootFiles', () => {
  test('detects present common files and never README', async () => {
    await writeFile('LICENSE', 'MIT')
    await writeFile('README.md', '# readme')
    const files = await scanCommonRootFiles(dir)
    expect(files).toContain('LICENSE')
    expect(files).not.toContain('README.md')
  })
})

// --- Supplementary reconciliation ---

describe('reconcileSupplementary', () => {
  const manifest: FacetManifest = {
    name: 'test',
    version: '1.0.0',
    skills: { review: { description: 'Review', files: ['references/api.md'] } },
    files: ['LICENSE', 'docs/guide.md'],
  }

  test('flags undeclared companions and declared-missing companions', () => {
    const items = reconcileSupplementary(manifest, {
      companionsBySkill: { review: ['scripts/run.ts'] }, // api.md missing, run.ts undeclared
      presentRootFiles: ['LICENSE', 'docs/guide.md'],
    })
    expect(items).toContainEqual({
      kind: 'companion-addition',
      skill: 'review',
      relPath: 'scripts/run.ts',
      path: 'skills/review/scripts/run.ts',
    })
    expect(items).toContainEqual({
      kind: 'companion-missing',
      skill: 'review',
      relPath: 'references/api.md',
      expectedPath: 'skills/review/references/api.md',
    })
  })

  test('flags undeclared common root files and declared-missing root files', () => {
    const items = reconcileSupplementary(manifest, {
      companionsBySkill: { review: ['references/api.md'] },
      presentRootFiles: ['CONTRIBUTING.md'], // LICENSE + docs/guide.md declared but absent; CONTRIBUTING undeclared
    })
    expect(items).toContainEqual({ kind: 'root-addition', path: 'CONTRIBUTING.md' })
    expect(items).toContainEqual({ kind: 'root-missing', path: 'LICENSE' })
    expect(items).toContainEqual({ kind: 'root-missing', path: 'docs/guide.md' })
  })
})

// --- README states ---

describe('computeReadmeStates', () => {
  test('classifies each conventional path independently', () => {
    const manifest: FacetManifest = { name: 't', version: '1.0.0', files: ['README.md'] }
    const states = computeReadmeStates(manifest, { present: { 'README.md': '# hi' } })
    const md = states.find((s) => s.path === 'README.md')
    const plain = states.find((s) => s.path === 'README')
    expect(md?.state).toBe('present-declared')
    expect(plain?.state).toBe('absent-undeclared')
  })

  test('present-undeclared and declared-missing', () => {
    const manifest: FacetManifest = { name: 't', version: '1.0.0', files: ['README'] }
    const states = computeReadmeStates(manifest, { present: { 'README.md': 'x' } })
    expect(states.find((s) => s.path === 'README.md')?.state).toBe('present-undeclared')
    expect(states.find((s) => s.path === 'README')?.state).toBe('declared-missing')
  })
})

// --- README actions ---

describe('readmeActionOptions', () => {
  test('present-declared offers Edit and Remove', () => {
    const opts = readmeActionOptions({ path: 'README.md', state: 'present-declared', content: '# x' })
    expect(opts.map((o) => o.kind)).toEqual(['edit', 'remove'])
    expect(opts.find((o) => o.kind === 'edit')?.requiresEditor).toBe(true)
    expect(opts.find((o) => o.kind === 'remove')?.requiresEditor).toBe(false)
  })

  test('present-undeclared offers Adopt and Edit-and-adopt', () => {
    const opts = readmeActionOptions({ path: 'README.md', state: 'present-undeclared', content: '# x' })
    expect(opts.map((o) => o.kind)).toEqual(['adopt', 'edit-and-adopt'])
    expect(opts.find((o) => o.kind === 'adopt')?.requiresEditor).toBe(false)
  })

  test('declared-missing offers Scaffold and Remove Declaration', () => {
    const opts = readmeActionOptions({ path: 'README', state: 'declared-missing' })
    expect(opts.map((o) => o.kind)).toEqual(['scaffold', 'remove-declaration'])
    expect(opts.find((o) => o.kind === 'scaffold')?.label).toContain('README')
  })

  test('absent-undeclared offers only Create', () => {
    const opts = readmeActionOptions({ path: 'README', state: 'absent-undeclared' })
    expect(opts.map((o) => o.kind)).toEqual(['create'])
    expect(README_CREATE_DEFAULT).toBe('README.md')
  })
})

describe('readme action derivation', () => {
  test('adopt adds declaration and writes no file (preserves bytes)', () => {
    const action = readmeActionFor('adopt', '# ignored')
    const ops = readmeFileOperations({ path: 'README.md', action })
    expect(ops).toEqual([])
    const m = applyReadmeDeclaration({ name: 't', version: '1.0.0' }, { path: 'README.md', action })
    expect(m.files).toEqual(['README.md'])
  })

  test('edit-and-adopt writes bytes and adds declaration', () => {
    const action = readmeActionFor('edit-and-adopt', '# edited')
    const ops = readmeFileOperations({ path: 'README.md', action })
    expect(ops).toEqual([{ op: 'write-file', path: 'README.md', content: '# edited' }])
    const m = applyReadmeDeclaration({ name: 't', version: '1.0.0' }, { path: 'README.md', action })
    expect(m.files).toEqual(['README.md'])
  })

  test('remove deletes file and drops declaration together', () => {
    const action = readmeActionFor('remove', '')
    const ops = readmeFileOperations({ path: 'README.md', action })
    expect(ops).toEqual([{ op: 'delete-file', path: 'README.md' }])
    const m = applyReadmeDeclaration(
      { name: 't', version: '1.0.0', files: ['README.md'] },
      { path: 'README.md', action },
    )
    expect('files' in m).toBe(false)
  })

  test('scaffold at exact declared path writes bytes; declaration already present stays', () => {
    const action = readmeActionFor('scaffold', '# t\n')
    const ops = readmeFileOperations({ path: 'README', action })
    expect(ops).toEqual([{ op: 'write-file', path: 'README', content: '# t\n' }])
    const m = applyReadmeDeclaration({ name: 't', version: '1.0.0', files: ['README'] }, { path: 'README', action })
    expect(m.files).toEqual(['README'])
  })

  test('remove-declaration drops declaration and writes no file', () => {
    const action = readmeActionFor('remove-declaration', '')
    const ops = readmeFileOperations({ path: 'README', action })
    expect(ops).toEqual([])
    const m = applyReadmeDeclaration({ name: 't', version: '1.0.0', files: ['README'] }, { path: 'README', action })
    expect('files' in m).toBe(false)
  })

  test('create defaults to README.md, writes bytes and declares', () => {
    const action = readmeActionFor('create', '# new\n')
    const ops = readmeFileOperations({ path: README_CREATE_DEFAULT, action })
    expect(ops).toEqual([{ op: 'write-file', path: 'README.md', content: '# new\n' }])
    const m = applyReadmeDeclaration({ name: 't', version: '1.0.0' }, { path: README_CREATE_DEFAULT, action })
    expect(m.files).toEqual(['README.md'])
  })

  test('readmeOptionKindFor round-trips a chosen option', () => {
    expect(readmeOptionKindFor(readmeActionFor('edit', 'x'))).toBe('edit')
    expect(readmeOptionKindFor({ kind: 'none' })).toBeNull()
  })
})

// --- Declaration mutations ---

describe('declaration mutations', () => {
  const base: FacetManifest = {
    name: 't',
    version: '1.0.0',
    skills: { review: { description: 'R' } },
  }

  test('addTopLevelFile keeps files sorted and de-duplicated', () => {
    let m = addTopLevelFile(base, 'README.md')
    m = addTopLevelFile(m, 'LICENSE')
    m = addTopLevelFile(m, 'LICENSE')
    expect(m.files).toEqual(['LICENSE', 'README.md'])
  })

  test('removeTopLevelFile drops the files key when empty', () => {
    const m = removeTopLevelFile(addTopLevelFile(base, 'README.md'), 'README.md')
    expect('files' in m).toBe(false)
  })

  test('add/removeSkillCompanion mutate the owning skill only', () => {
    const added = addSkillCompanion(base, 'review', 'references/api.md')
    expect(added.skills?.review?.files).toEqual(['references/api.md'])
    const removed = removeSkillCompanion(added, 'review', 'references/api.md')
    expect('files' in (removed.skills?.review ?? {})).toBe(false)
  })
})

// --- Transactional apply ---

describe('applyEditOperations', () => {
  const manifest: FacetManifest = {
    name: 'test',
    version: '1.0.0',
    skills: { review: { description: 'R', files: ['references/api.md'] } },
  }

  test('scaffolds assets and writes supplementary files atomically', async () => {
    const ops: EditOperation[] = [
      { op: 'write-manifest', manifest },
      { op: 'scaffold-asset', assetType: 'skills', name: 'review' },
      { op: 'write-file', path: 'LICENSE', content: '' },
    ]
    const result = await applyEditOperations(ops, dir)
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, 'facet.json'))).toBe(true)
    expect(existsSync(join(dir, 'skills/review/SKILL.md'))).toBe(true)
    expect(readFileSync(join(dir, 'LICENSE'), 'utf8')).toBe('')
  })

  test('delete-asset removes primary and declared companions, preserves unowned files', async () => {
    await writeFile('skills/review/SKILL.md', '# R')
    await writeFile('skills/review/references/api.md', '# API')
    await writeFile('skills/review/notes.txt', 'unowned')
    const ops: EditOperation[] = [
      { op: 'write-manifest', manifest: { name: 'test', version: '1.0.0' } },
      { op: 'delete-asset', assetType: 'skills', name: 'review', companionPaths: ['skills/review/references/api.md'] },
    ]
    const result = await applyEditOperations(ops, dir)
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, 'skills/review/SKILL.md'))).toBe(false)
    expect(existsSync(join(dir, 'skills/review/references/api.md'))).toBe(false)
    // Undeclared file survives.
    expect(existsSync(join(dir, 'skills/review/notes.txt'))).toBe(true)
  })

  test('rolls back every mutation when one write fails', async () => {
    await writeFile('facet.json', 'ORIGINAL')
    // Make skills a file so the SKILL.md write fails mid-transaction.
    await writeFile('skills', 'not a dir')
    const ops: EditOperation[] = [
      { op: 'write-manifest', manifest },
      { op: 'scaffold-asset', assetType: 'skills', name: 'review' },
    ]
    const result = await applyEditOperations(ops, dir)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.rollbackOk).toBe(true)
    expect(readFileSync(join(dir, 'facet.json'), 'utf8')).toBe('ORIGINAL')
  })
})

// --- Operation preview ---

describe('previewEditOperations', () => {
  test('lists exact paths including each deleted companion', () => {
    const lines = previewEditOperations([
      { op: 'write-manifest', manifest: { name: 't', version: '1.0.0' } },
      { op: 'delete-asset', assetType: 'skills', name: 'review', companionPaths: ['skills/review/references/api.md'] },
      { op: 'write-file', path: 'README.md', content: '# hi' },
    ])
    expect(lines).toEqual([
      { verb: 'Update', path: 'facet.json' },
      { verb: 'Delete', path: 'skills/review/SKILL.md' },
      { verb: 'Delete', path: 'skills/review/references/api.md' },
      { verb: 'Write', path: 'README.md' },
    ])
  })
})

// --- Context integration ---

describe('buildEditContext supplementary + README', () => {
  test('discovers companions, common root files, and routes README to the panel only', async () => {
    await writeFile(
      'facet.json',
      JSON.stringify({
        name: 'test',
        version: '1.0.0',
        skills: { review: { description: 'R' } },
        files: ['README.md'],
      }),
    )
    await writeFile('skills/review/SKILL.md', '# Review')
    await writeFile('skills/review/references/api.md', '# API') // undeclared companion
    await writeFile('LICENSE', 'MIT') // undeclared common root file
    await writeFile('README.md', '# readme') // declared → README panel, not generic

    const result = await buildEditContext(dir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    const { reconciliationItems, readme } = result.context

    expect(reconciliationItems).toContainEqual({
      kind: 'companion-addition',
      skill: 'review',
      relPath: 'references/api.md',
      path: 'skills/review/references/api.md',
    })
    expect(reconciliationItems).toContainEqual({ kind: 'root-addition', path: 'LICENSE' })
    // README never appears in generic reconciliation.
    expect(reconciliationItems.some((i) => i.kind === 'root-addition' && i.path === 'README.md')).toBe(false)
    // README is surfaced via the dedicated panel state.
    expect(readme.find((s) => s.path === 'README.md')?.state).toBe('present-declared')
  })
})
