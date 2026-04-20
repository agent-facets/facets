import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFileSync } from '../atomic-write.ts'

describe('atomicWriteFileSync', () => {
  test('creates a new file with the given contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'))
    const path = join(dir, 'file.txt')
    atomicWriteFileSync(path, 'hello')
    expect(readFileSync(path, 'utf8')).toBe('hello')
  })

  test('overwrites an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'))
    const path = join(dir, 'file.txt')
    writeFileSync(path, 'old content', 'utf8')
    atomicWriteFileSync(path, 'new content')
    expect(readFileSync(path, 'utf8')).toBe('new content')
  })

  test('does not leave a .tmp sibling on success', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'))
    const path = join(dir, 'file.txt')
    atomicWriteFileSync(path, 'hello')
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })
})
