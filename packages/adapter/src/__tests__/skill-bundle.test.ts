import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assembleAssetContent } from '../asset-fs.ts'
import { planSkillBundleInstall, planSkillBundleRemoval, type SkillBundleTarget } from '../skill-bundle.ts'
import type { CompanionMap } from '../types.ts'

let root: string
let target: SkillBundleTarget

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'facet-skill-plan-')))
  target = {
    root: join(root, 'skills', 'planning'),
    primaryFile: join(root, 'skills', 'planning', 'SKILL.md'),
    boundary: root,
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

function seed(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function bundle(companions: CompanionMap = {}, owned: readonly string[] = []) {
  return { content: '# planning\n', metadata: { name: 'planning' }, companions, ownedCompanionPaths: owned }
}

describe('planSkillBundleInstall', () => {
  test('plans the primary and every companion for a fresh bundle', () => {
    const result = planSkillBundleInstall(target, bundle({ 'references/api.md': encode('api\n') }))

    if (!result.ok) expect.unreachable()
    expect(result.plan.occupancy).toBe('absent')
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    expect(result.plan.action.mutations.map((mutation) => mutation.path)).toEqual([
      target.primaryFile,
      join(target.root, 'references/api.md'),
    ])
  })

  test('plans nothing when every file already matches', () => {
    seed(target.primaryFile, assembleAssetContent('# planning\n', { name: 'planning' }))
    seed(join(target.root, 'references/api.md'), 'api\n')

    const result = planSkillBundleInstall(
      target,
      bundle({ 'references/api.md': encode('api\n') }, ['references/api.md']),
    )

    if (!result.ok) expect.unreachable()
    expect(result.plan.occupancy).toBe('equivalent')
    expect(result.plan.action.kind).toBe('unchanged')
  })

  test('plans only the companion that drifted', () => {
    seed(target.primaryFile, assembleAssetContent('# planning\n', { name: 'planning' }))
    seed(join(target.root, 'a.md'), 'same\n')
    seed(join(target.root, 'b.md'), 'stale\n')

    const result = planSkillBundleInstall(
      target,
      bundle({ 'a.md': encode('same\n'), 'b.md': encode('fresh\n') }, ['a.md', 'b.md']),
    )

    if (!result.ok) expect.unreachable()
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    expect(result.plan.action.mutations).toHaveLength(1)
    expect(result.plan.action.mutations[0].path).toBe(join(target.root, 'b.md'))
  })

  test('deletes owned companions the new bundle drops, and nothing else', () => {
    seed(target.primaryFile, 'old primary\n')
    seed(join(target.root, 'kept.md'), 'kept\n')
    seed(join(target.root, 'dropped.md'), 'dropped\n')
    seed(join(target.root, 'user-file.md'), 'not ours\n')

    const result = planSkillBundleInstall(target, bundle({ 'kept.md': encode('kept\n') }, ['kept.md', 'dropped.md']))

    if (!result.ok) expect.unreachable()
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    const deletions = result.plan.action.mutations.filter((mutation) => mutation.kind === 'delete')
    expect(deletions.map((mutation) => mutation.path)).toEqual([join(target.root, 'dropped.md')])
  })

  test('an owned companion that is already gone contributes no deletion', () => {
    seed(target.primaryFile, assembleAssetContent('# planning\n', { name: 'planning' }))

    const result = planSkillBundleInstall(target, bundle({}, ['vanished.md']))

    if (!result.ok) expect.unreachable()
    expect(result.plan.action.kind).toBe('unchanged')
  })

  test('reports divergence when the primary differs', () => {
    seed(target.primaryFile, 'hand written\n')

    const result = planSkillBundleInstall(target, bundle())

    if (!result.ok) expect.unreachable()
    expect(result.plan.occupancy).toBe('divergent')
  })

  test('planning writes nothing to disk', () => {
    seed(target.primaryFile, 'existing\n')
    const before = statSync(target.primaryFile)

    planSkillBundleInstall(target, bundle({ 'new.md': encode('new\n') }))

    expect(statSync(target.primaryFile).mtimeMs).toBe(before.mtimeMs)
    expect(() => statSync(join(target.root, 'new.md'))).toThrow()
  })

  describe('containment', () => {
    test('rejects a companion escaping the skill root', () => {
      const result = planSkillBundleInstall(target, bundle({ '../escape.md': encode('x') }))
      if (result.ok) expect.unreachable()
      expect(result.failure.code).toBe('invalid-companion-path')
    })

    test('rejects an absolute companion path', () => {
      const result = planSkillBundleInstall(target, bundle({ '/etc/passwd': encode('x') }))
      if (result.ok) expect.unreachable()
      expect(result.failure.code).toBe('invalid-companion-path')
    })

    test('rejects a companion that targets the primary file', () => {
      const result = planSkillBundleInstall(target, bundle({ 'SKILL.md': encode('x') }))
      if (result.ok) expect.unreachable()
      if (result.failure.code !== 'invalid-companion-path') expect.unreachable()
      expect(result.failure.reason).toContain('primary file')
    })

    test('rejects two companions colliding by case folding', () => {
      const result = planSkillBundleInstall(target, bundle({ 'Notes.md': encode('a'), 'notes.md': encode('b') }))
      if (result.ok) expect.unreachable()
      if (result.failure.code !== 'invalid-companion-path') expect.unreachable()
      expect(result.failure.reason).toContain('case folding')
    })

    test('rejects a primary outside the declared skill root', () => {
      const result = planSkillBundleInstall(
        { root: target.root, primaryFile: join(root, 'elsewhere.md'), boundary: root },
        bundle(),
      )
      if (result.ok) expect.unreachable()
      expect(result.failure.code).toBe('invalid-companion-path')
    })

    test('a companion literally named __proto__ is handled as an own key', () => {
      const companions: CompanionMap = Object.create(null)
      companions.__proto__ = encode('payload\n')

      const result = planSkillBundleInstall(target, bundle(companions))

      if (!result.ok) expect.unreachable()
      if (result.plan.action.kind !== 'mutate') expect.unreachable()
      const written = result.plan.action.mutations.find((mutation) => mutation.path.endsWith('__proto__'))
      if (written?.kind !== 'write') expect.unreachable()
      expect(decode(written.contents)).toBe('payload\n')
    })
  })
})

describe('planSkillBundleRemoval', () => {
  test('removes the primary and exactly the owned companions', () => {
    seed(target.primaryFile, 'primary\n')
    seed(join(target.root, 'owned.md'), 'owned\n')
    seed(join(target.root, 'user-file.md'), 'not ours\n')

    const result = planSkillBundleRemoval(target, ['owned.md'])

    if (!result.ok) expect.unreachable()
    if (result.plan.kind !== 'remove') expect.unreachable()
    expect(result.plan.action.mutations.map((mutation) => mutation.path)).toEqual([
      target.primaryFile,
      join(target.root, 'owned.md'),
    ])
  })

  test('reports absence when nothing owned remains', () => {
    const result = planSkillBundleRemoval(target, ['owned.md'])

    if (!result.ok) expect.unreachable()
    expect(result.plan.kind).toBe('absent')
  })

  test('removes owned companions even when the primary is already gone', () => {
    seed(join(target.root, 'orphan.md'), 'orphan\n')

    const result = planSkillBundleRemoval(target, ['orphan.md'])

    if (!result.ok) expect.unreachable()
    if (result.plan.kind !== 'remove') expect.unreachable()
    expect(result.plan.action.mutations).toHaveLength(1)
    const [mutation] = result.plan.action.mutations
    if (mutation.expected.kind !== 'regular-file') expect.unreachable()
    expect(decode(mutation.expected.contents)).toBe('orphan\n')
  })

  test('rejects a malformed owned path before reading anything', () => {
    const result = planSkillBundleRemoval(target, ['../escape.md'])
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-companion-path')
  })
})
