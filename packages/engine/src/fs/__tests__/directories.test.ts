import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDirectories } from '../directories.ts'
import { nodeFsSyscalls } from '../syscalls.ts'
import { errnoError, makeTempRoot, occupyOnMkdir, removeTempRoot } from './helpers.ts'

/**
 * Creating a directory is where containment is decided.
 *
 * `mkdir` reports `EEXIST` for any taken name, not only for a directory, and
 * the staging open below constrains only the FINAL component — every ancestor
 * is followed. So a symlink accepted here redirects the write out of the
 * boundary entirely, with the transaction reporting success.
 */

let root: string
let outside: string

beforeEach(() => {
  root = makeTempRoot('facet-directories-')
  outside = makeTempRoot('facet-outside-')
})

afterEach(() => {
  removeTempRoot(root)
  removeTempRoot(outside)
})

/** The file a walk is creating directories for. */
const target = (...parts: string[]): string => join(root, ...parts, 'asset.md')

describe('losing the race to create a directory', () => {
  test('refuses a symlink that appeared below the boundary', () => {
    const component = join(root, 'agents')
    const sys = occupyOnMkdir(
      (path) => path === component,
      (path) => symlinkSync(outside, path),
    )

    const result = ensureDirectories(target('agents'), root, sys)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'inspection') expect.unreachable()
    expect(result.failure.reason).toBe('symlinked-ancestor')
    if (result.failure.reason !== 'symlinked-ancestor') expect.unreachable()
    expect(result.failure.component).toBe(component)
    expect(readdirSync(outside)).toEqual([])
  })

  test('refuses a plain file that appeared at the component', () => {
    const component = join(root, 'skills')
    const sys = occupyOnMkdir(
      (path) => path === component,
      (path) => writeFileSync(path, 'not a directory\n'),
    )

    const result = ensureDirectories(target('skills'), root, sys)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'inspection') expect.unreachable()
    expect(result.failure.reason).toBe('parent-unusable')
  })

  test('accepts a real directory that appeared, and does not claim it', () => {
    const component = join(root, 'commands')
    const sys = occupyOnMkdir(
      (path) => path === component,
      (path) => mkdirSync(path),
    )

    const result = ensureDirectories(target('commands'), root, sys)

    if (!result.ok) expect.unreachable()
    // Recording it would let a rollback delete another process's directory.
    expect(result.created.map((entry) => entry.path)).not.toContain(component)
  })

  test('reports an inspection that fails after the lost race', () => {
    const component = join(root, 'agents')
    const sys = occupyOnMkdir(
      (path) => path === component,
      (path) => writeFileSync(path, 'x'),
      { lstatAfter: { code: 'EACCES' } },
    )

    const result = ensureDirectories(target('agents'), root, sys)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'inspection') expect.unreachable()
    if (result.failure.reason !== 'unreadable') expect.unreachable()
    expect(result.failure.code).toBe('EACCES')
  })

  test('classifies ENOTDIR after the lost race as an unusable parent', () => {
    const component = join(root, 'agents')
    const sys = occupyOnMkdir(
      (path) => path === component,
      (path) => writeFileSync(path, 'x'),
      { lstatAfter: { code: 'ENOTDIR' } },
    )

    const result = ensureDirectories(target('agents'), root, sys)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'inspection') expect.unreachable()
    expect(result.failure.reason).toBe('parent-unusable')
  })

  test('retries once when the occupant vanishes again', () => {
    const component = join(root, 'agents')
    // Occupied for the first mkdir, gone by the time we look.
    const sys = occupyOnMkdir(
      (path) => path === component,
      () => {},
    )

    const result = ensureDirectories(target('agents'), root, sys)

    if (!result.ok) expect.unreachable()
    expect(result.created.map((entry) => entry.path)).toContain(component)
    expect(existsSync(component)).toBe(true)
  })

  test('gives up as data when the name keeps appearing and vanishing', () => {
    const component = join(root, 'agents')
    const sys = occupyOnMkdir(
      (path) => path === component,
      () => {},
      { times: 2 },
    )

    const result = ensureDirectories(target('agents'), root, sys)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'operation') expect.unreachable()
    expect(result.failure.operation).toBe('create-directory')
    expect(result.failure.code).toBe('EEXIST')
  })
})

describe('a symlinked boundary', () => {
  test('is legitimate when it reaches a directory', () => {
    const boundary = join(root, 'linked-config')
    const real = join(outside, 'dotfiles')
    mkdirSync(real)
    symlinkSync(real, boundary)

    const result = ensureDirectories(join(boundary, 'agents', 'asset.md'), boundary, nodeFsSyscalls)

    if (!result.ok) expect.unreachable()
    expect(result.created.map((entry) => entry.path)).not.toContain(boundary)
    expect(existsSync(join(real, 'agents'))).toBe(true)
  })

  test('is refused when it reaches something that is not a directory', () => {
    const boundary = join(root, 'linked-config')
    const real = join(outside, 'a-file')
    writeFileSync(real, 'not a directory\n')
    symlinkSync(real, boundary)

    const result = ensureDirectories(join(boundary, 'agents', 'asset.md'), boundary, nodeFsSyscalls)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'inspection') expect.unreachable()
    expect(result.failure.reason).toBe('parent-unusable')
  })

  test('is refused when it dangles', () => {
    const boundary = join(root, 'linked-config')
    symlinkSync(join(outside, 'nothing-here'), boundary)

    const result = ensureDirectories(join(boundary, 'agents', 'asset.md'), boundary, nodeFsSyscalls)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'inspection') expect.unreachable()
    expect(result.failure.reason).toBe('parent-unusable')
  })
})

describe('a component that was already a symlink', () => {
  test('is still refused without any race', () => {
    mkdirSync(join(root, 'real'))
    symlinkSync(join(root, 'real'), join(root, 'agents'))

    const result = ensureDirectories(target('agents'), root, nodeFsSyscalls)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'inspection') expect.unreachable()
    expect(result.failure.reason).toBe('symlinked-ancestor')
  })
})

describe('directories created before a later component fails', () => {
  test('are reported so the caller can still remove them', () => {
    const blocked = join(root, 'made', 'blocked')
    const sys = occupyOnMkdir(
      (path) => path === blocked,
      (path) => writeFileSync(path, 'not a directory\n'),
    )

    const result = ensureDirectories(target('made', 'blocked'), root, sys)

    if (result.ok) expect.unreachable()
    expect(result.created.map((entry) => entry.path)).toEqual([join(root, 'made')])
  })

  test('are reported when the failure is an operation rather than an inspection', () => {
    const blocked = join(root, 'made', 'blocked')
    const sys = {
      ...nodeFsSyscalls,
      mkdir(path: string) {
        if (path === blocked) throw errnoError('EACCES')
        nodeFsSyscalls.mkdir(path)
      },
    }

    const result = ensureDirectories(target('made', 'blocked'), root, sys)

    if (result.ok) expect.unreachable()
    if (result.reason !== 'operation') expect.unreachable()
    expect(result.created.map((entry) => entry.path)).toEqual([join(root, 'made')])
  })
})
