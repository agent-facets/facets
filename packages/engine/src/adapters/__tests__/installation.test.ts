import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { generationDir, isSafeGenerationId, newGenerationId, validateReceipt } from '../installation.ts'

const validNpmReceipt = {
  schemaVersion: 1,
  activeGeneration: 'gen-1-abc',
  apiVersion: '0.0',
  source: {
    kind: 'npm',
    specifier: 'opencode',
    packageName: '@agent-facets/adapter-opencode',
    version: '1.2.3',
    integrity: { kind: 'sri', value: 'sha512-abc' },
  },
}

describe('validateReceipt — valid receipts', () => {
  test('npm provenance round-trips', () => {
    const result = validateReceipt(validNpmReceipt)
    if (!result.ok) expect.unreachable()
    expect(result.receipt).toEqual(validNpmReceipt as never)
  })

  test('git provenance round-trips with optional ref', () => {
    const receipt = {
      schemaVersion: 1,
      activeGeneration: 'gen-2-def',
      apiVersion: '0.0',
      source: { kind: 'git', specifier: 'git+https://x/y.git#v1', url: 'https://x/y.git', ref: 'v1' },
    }
    const result = validateReceipt(receipt)
    if (!result.ok) expect.unreachable()
    expect(result.receipt).toEqual(receipt as never)
  })

  test('git provenance round-trips without ref', () => {
    const receipt = {
      schemaVersion: 1,
      activeGeneration: 'gen-2-def',
      apiVersion: '0.0',
      source: { kind: 'git', specifier: 'git+https://x/y.git', url: 'https://x/y.git' },
    }
    const result = validateReceipt(receipt)
    if (!result.ok) expect.unreachable()
    expect(result.receipt.source).toEqual({ kind: 'git', specifier: 'git+https://x/y.git', url: 'https://x/y.git' })
  })

  test('local provenance round-trips', () => {
    const receipt = {
      schemaVersion: 1,
      activeGeneration: 'gen-3',
      apiVersion: '0.0',
      source: { kind: 'local', specifier: './adapters/mine', sourcePath: '/abs/adapters/mine' },
    }
    const result = validateReceipt(receipt)
    if (!result.ok) expect.unreachable()
    expect(result.receipt.source.kind).toBe('local')
  })
})

describe('validateReceipt — invalid receipts', () => {
  test.each([
    ['not an object', 42],
    ['null', null],
    ['wrong schemaVersion', { ...validNpmReceipt, schemaVersion: 2 }],
    ['missing schemaVersion', { ...validNpmReceipt, schemaVersion: undefined }],
    ['unsafe generation id (traversal)', { ...validNpmReceipt, activeGeneration: '../escape' }],
    ['unsafe generation id (separator)', { ...validNpmReceipt, activeGeneration: 'a/b' }],
    ['unsafe generation id (hidden)', { ...validNpmReceipt, activeGeneration: '.hidden' }],
    ['unsafe generation id (empty)', { ...validNpmReceipt, activeGeneration: '' }],
    ['missing apiVersion', { ...validNpmReceipt, apiVersion: undefined }],
    ['missing source', { ...validNpmReceipt, source: undefined }],
    ['unknown source kind', { ...validNpmReceipt, source: { kind: 'ftp', specifier: 'x' } }],
    [
      'npm source without integrity',
      {
        ...validNpmReceipt,
        source: { kind: 'npm', specifier: 'x', packageName: 'x', version: '1.0.0' },
      },
    ],
    [
      'npm source with malformed integrity kind',
      {
        ...validNpmReceipt,
        source: {
          kind: 'npm',
          specifier: 'x',
          packageName: 'x',
          version: '1.0.0',
          integrity: { kind: 'md5', value: 'x' },
        },
      },
    ],
    ['git source without url', { ...validNpmReceipt, source: { kind: 'git', specifier: 'x' } }],
    [
      'git source with non-string ref',
      { ...validNpmReceipt, source: { kind: 'git', specifier: 'x', url: 'https://x', ref: 42 } },
    ],
    ['local source without sourcePath', { ...validNpmReceipt, source: { kind: 'local', specifier: 'x' } }],
    ['source without specifier', { ...validNpmReceipt, source: { kind: 'local', sourcePath: '/x' } }],
  ])('rejects %s', (_label, receipt) => {
    const result = validateReceipt(receipt)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('invalid')
  })
})

describe('generation ids', () => {
  test('newGenerationId mints safe unique ids', () => {
    const a = newGenerationId()
    const b = newGenerationId()
    expect(isSafeGenerationId(a)).toBe(true)
    expect(isSafeGenerationId(b)).toBe(true)
    expect(a).not.toBe(b)
  })

  test.each(['gen-1', 'a', 'A.b_c-d', '0'])('accepts safe id %s', (id) => {
    expect(isSafeGenerationId(id)).toBe(true)
  })

  test.each(['', '.', '..', '.hidden', 'a/b', 'a\\b', '../x', '-flag'])('rejects unsafe id %j', (id) => {
    expect(isSafeGenerationId(id)).toBe(false)
  })

  test('generationDir resolves contained paths', () => {
    expect(generationDir('/base/adapters/x', 'gen-1')).toBe(join('/base/adapters/x', 'generations', 'gen-1'))
  })

  test('generationDir returns null for unsafe ids', () => {
    expect(generationDir('/base/adapters/x', '../../escape')).toBeNull()
    expect(generationDir('/base/adapters/x', 'a/b')).toBeNull()
  })
})
