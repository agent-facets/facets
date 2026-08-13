import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleAssetContent, planSingleFileInstall, planSingleFileRemoval, splitAssetContent } from '../asset-fs.ts'

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'facet-asset-plan-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

describe('planSingleFileInstall', () => {
  test('plans a create when nothing is there', () => {
    const file = join(root, 'agents', 'reviewer.md')
    const result = planSingleFileInstall({ file, boundary: root }, '# body\n', { name: 'reviewer' })

    if (!result.ok) expect.unreachable()
    expect(result.plan.occupancy).toBe('absent')
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    const [mutation] = result.plan.action.mutations
    expect(mutation.kind).toBe('write')
    expect(mutation.path).toBe(file)
    expect(mutation.expected.kind).toBe('absent')
  })

  test('writes nothing when the file already holds exactly these bytes', () => {
    const file = join(root, 'reviewer.md')
    writeFileSync(file, assembleAssetContent('# body\n', { name: 'reviewer' }))

    const result = planSingleFileInstall({ file, boundary: root }, '# body\n', { name: 'reviewer' })

    if (!result.ok) expect.unreachable()
    expect(result.plan.occupancy).toBe('equivalent')
    expect(result.plan.action.kind).toBe('unchanged')
  })

  test('reports divergence and carries the exact prior state', () => {
    const file = join(root, 'reviewer.md')
    writeFileSync(file, 'hand written\n')
    chmodSync(file, 0o640)

    const result = planSingleFileInstall({ file, boundary: root }, '# body\n', { name: 'reviewer' })

    if (!result.ok) expect.unreachable()
    expect(result.plan.occupancy).toBe('divergent')
    if (result.plan.action.kind !== 'mutate') expect.unreachable()
    const [mutation] = result.plan.action.mutations
    if (mutation.expected.kind !== 'regular-file') expect.unreachable()
    expect(decode(mutation.expected.contents)).toBe('hand written\n')
    expect(mutation.expected.mode).toBe(0o640)
  })

  test('refuses to plan through a directory standing at the target', () => {
    const file = join(root, 'occupied')
    mkdirSync(file)

    const result = planSingleFileInstall({ file, boundary: root }, 'x', undefined)

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('unsupported-object')
  })

  test('planning writes nothing to disk', () => {
    const file = join(root, 'untouched.md')
    writeFileSync(file, 'before\n')
    const before = statSync(file)

    planSingleFileInstall({ file, boundary: root }, '# other\n', { name: 'x' })

    const after = statSync(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.ino).toBe(before.ino)
  })
})

describe('planSingleFileRemoval', () => {
  test('reports absence rather than planning an empty batch', () => {
    const result = planSingleFileRemoval({ file: join(root, 'gone.md'), boundary: root })

    if (!result.ok) expect.unreachable()
    expect(result.plan.kind).toBe('absent')
  })

  test('plans one deletion carrying the exact prior state', () => {
    const file = join(root, 'present.md')
    writeFileSync(file, 'contents\n')

    const result = planSingleFileRemoval({ file, boundary: root })

    if (!result.ok) expect.unreachable()
    if (result.plan.kind !== 'remove') expect.unreachable()
    const [mutation] = result.plan.action.mutations
    expect(mutation.kind).toBe('delete')
    if (mutation.expected.kind !== 'regular-file') expect.unreachable()
    expect(decode(mutation.expected.contents)).toBe('contents\n')
  })
})

describe('front-matter round trip', () => {
  test('assemble → split returns the original body and metadata', () => {
    const assembled = assembleAssetContent('# heading\n\nbody\n', { name: 'planning', description: 'plan things' })
    const split = splitAssetContent(assembled)

    expect(split.content).toBe('# heading\n\nbody\n')
    expect(split.metadata).toEqual({ name: 'planning', description: 'plan things' })
  })

  test('emits no separator newline between the fence and the body', () => {
    const assembled = assembleAssetContent('# body\n', { name: 'x' })
    expect(assembled).toBe('---\nname: x\n---\n# body\n')
  })

  test('a body with no metadata is stored verbatim', () => {
    expect(assembleAssetContent('# body\n', {})).toBe('# body\n')
  })

  test("caller metadata wins over the body's own front matter", () => {
    const assembled = assembleAssetContent('---\nname: authored\ntools: [grep]\n---\n# body\n', { name: 'effective' })
    const split = splitAssetContent(assembled)

    expect(split.metadata).toEqual({ name: 'effective', tools: ['grep'] })
    expect(split.content).toBe('# body\n')
  })

  test('assembling the same request twice produces identical bytes', () => {
    const once = assembleAssetContent('# body\n', { name: 'x', description: 'y' })
    const twice = assembleAssetContent('# body\n', { name: 'x', description: 'y' })
    expect(once).toBe(twice)
  })
})
