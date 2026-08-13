import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, linkSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspectFileState } from '@agent-facets/common'
import { nodeFsSyscalls } from '../syscalls.ts'
import { bytes, makeTempRoot, removeTempRoot, text } from './helpers.ts'

/**
 * Inspection has to fail closed on everything that is not a plain file,
 * because every guarantee downstream — exact restoration, safe replacement —
 * assumes the thing at that path is bytes and nothing more.
 */

let root: string

beforeEach(() => {
  root = makeTempRoot('facet-file-state-')
})

afterEach(() => {
  removeTempRoot(root)
})

describe('inspectFileState', () => {
  test('reports a missing path as absent', () => {
    const result = inspectFileState(join(root, 'nothing.md'), nodeFsSyscalls)
    if (!result.ok) expect.unreachable()
    expect(result.state.kind).toBe('absent')
  })

  test('reads exact bytes and permission bits', () => {
    const file = join(root, 'hook.sh')
    writeFileSync(file, 'run me\n')
    chmodSync(file, 0o755)

    const result = inspectFileState(file, nodeFsSyscalls)
    if (!result.ok) expect.unreachable()
    if (result.state.kind !== 'regular-file') expect.unreachable()
    expect(text(result.state.contents)).toBe('run me\n')
    expect(result.state.mode).toBe(0o755)
  })

  test('preserves arbitrary binary content', () => {
    const file = join(root, 'blob.bin')
    const payload = new Uint8Array([0, 1, 2, 255, 0, 128])
    writeFileSync(file, payload)

    const result = inspectFileState(file, nodeFsSyscalls)
    if (!result.ok) expect.unreachable()
    if (result.state.kind !== 'regular-file') expect.unreachable()
    expect([...result.state.contents]).toEqual([...payload])
  })

  test('refuses a symlink rather than following it', () => {
    const target = join(root, 'target.md')
    writeFileSync(target, 'real')
    const link = join(root, 'link.md')
    symlinkSync(target, link)

    const result = inspectFileState(link, nodeFsSyscalls)
    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unsupported-object') expect.unreachable()
    expect(result.failure.objectKind).toBe('symlink')
  })

  test('refuses a directory standing where a file is expected', () => {
    const path = join(root, 'occupied')
    mkdirSync(path)

    const result = inspectFileState(path, nodeFsSyscalls)
    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unsupported-object') expect.unreachable()
    expect(result.failure.objectKind).toBe('directory')
  })

  test('refuses a hard-linked file, whose link topology replacement would break', () => {
    const original = join(root, 'original.md')
    writeFileSync(original, 'shared')
    const alias = join(root, 'alias.md')
    linkSync(original, alias)

    const result = inspectFileState(original, nodeFsSyscalls)
    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unsupported-object') expect.unreachable()
    expect(result.failure.objectKind).toBe('hard-linked')
  })

  test('reports a non-directory ancestor as parent-unusable, never as absence', () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'not a directory')

    const result = inspectFileState(join(blocker, 'child.md'), nodeFsSyscalls)
    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('parent-unusable')
  })

  const fifoAvailable = (() => {
    try {
      return Bun.spawnSync(['which', 'mkfifo']).exitCode === 0
    } catch {
      return false
    }
  })()

  test.skipIf(!fifoAvailable)('refuses a FIFO instead of blocking on a read', () => {
    const fifo = join(root, 'pipe')
    Bun.spawnSync(['mkfifo', fifo])

    const result = inspectFileState(fifo, nodeFsSyscalls)
    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unsupported-object') expect.unreachable()
    expect(result.failure.objectKind).toBe('fifo')
  })

  test('round-trips content unchanged through inspection', () => {
    const file = join(root, 'doc.md')
    writeFileSync(file, bytes('# heading\n\nbody\n'))

    const result = inspectFileState(file, nodeFsSyscalls)
    if (!result.ok) expect.unreachable()
    if (result.state.kind !== 'regular-file') expect.unreachable()
    expect(text(result.state.contents)).toBe('# heading\n\nbody\n')
  })
})
