import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { assertInsideTempDir, verifyTarballIntegrity } from '../npm.ts'

/**
 * F16 unit tests — focused on the two hardening guards. Exercising the whole
 * `downloadNpmPackage` pipeline would need a fake registry + crafted
 * gzipped tarball; these tests target the guards directly so regressions
 * show up instantly instead of hiding behind integration complexity.
 */

describe('verifyTarballIntegrity — SRI', () => {
  const bytes = new Uint8Array(Buffer.from('hello-facet'))

  function sri(algo: 'sha256' | 'sha512' | 'sha1', input: Uint8Array): string {
    return `${algo}-${createHash(algo).update(input).digest('base64')}`
  }

  test('accepts a correct sha512 integrity', () => {
    expect(() => verifyTarballIntegrity('pkg', bytes, sri('sha512', bytes), undefined)).not.toThrow()
  })

  test('accepts a correct sha256 integrity', () => {
    expect(() => verifyTarballIntegrity('pkg', bytes, sri('sha256', bytes), undefined)).not.toThrow()
  })

  test('rejects a mismatched integrity', () => {
    expect(() => verifyTarballIntegrity('pkg', bytes, sri('sha512', new Uint8Array([1])), undefined)).toThrow(
      /integrity mismatch/,
    )
  })

  test('rejects an unsupported algorithm', () => {
    expect(() => verifyTarballIntegrity('pkg', bytes, 'md5-abc', undefined)).toThrow(/no supported algorithm/)
  })

  test('accepts shasum fallback when SRI is absent', () => {
    const shasum = createHash('sha1').update(bytes).digest('hex')
    expect(() => verifyTarballIntegrity('pkg', bytes, undefined, shasum)).not.toThrow()
  })

  test('rejects a wrong shasum', () => {
    expect(() => verifyTarballIntegrity('pkg', bytes, undefined, 'deadbeef')).toThrow(/shasum mismatch/)
  })

  test('rejects when both integrity and shasum are missing', () => {
    expect(() => verifyTarballIntegrity('pkg', bytes, undefined, undefined)).toThrow(/no integrity or shasum/)
  })
})

describe('assertInsideTempDir — tar-slip defense', () => {
  const tempDir = '/tmp/facet-npm-test'

  test('accepts a normal nested path', () => {
    expect(() => assertInsideTempDir(tempDir, join(tempDir, 'sub/file.js'), 'pkg', 'package/sub/file.js')).not.toThrow()
  })

  test('accepts the tempDir itself at depth 0', () => {
    expect(() => assertInsideTempDir(tempDir, join(tempDir, 'file.js'), 'pkg', 'package/file.js')).not.toThrow()
  })

  test('rejects a parent-escape via `..`', () => {
    // Simulate what `join(tempDir, '../../etc/passwd')` would produce.
    expect(() => assertInsideTempDir(tempDir, '/etc/passwd', 'pkg', 'package/../../etc/passwd')).toThrow(
      /escapes the extraction directory/,
    )
  })

  test('rejects a sibling-directory escape', () => {
    expect(() => assertInsideTempDir(tempDir, '/tmp/other-dir/file', 'pkg', 'package/../other-dir/file')).toThrow(
      /escapes the extraction directory/,
    )
  })
})
