import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { assertInsideTempDir, verifyTarballIntegrity } from '../npm.ts'

/**
 * F16 unit tests — focused on the two hardening guards. Exercising the whole
 * `downloadNpmPackage` pipeline would need a fake registry + crafted
 * gzipped tarball; these tests target the guards directly so regressions
 * show up instantly instead of hiding behind integration complexity.
 *
 * Both guards now return discriminated results instead of throwing —
 * callers pattern-match on `result.reason` rather than parsing message
 * strings. (#3 cluster C.)
 */

describe('verifyTarballIntegrity — SRI', () => {
  const bytes = new Uint8Array(Buffer.from('hello-facet'))

  function sri(algo: 'sha256' | 'sha512' | 'sha1', input: Uint8Array): string {
    return `${algo}-${createHash(algo).update(input).digest('base64')}`
  }

  test('accepts a correct sha512 integrity', () => {
    expect(verifyTarballIntegrity('pkg', bytes, sri('sha512', bytes), undefined)).toEqual({ ok: true })
  })

  test('accepts a correct sha256 integrity', () => {
    expect(verifyTarballIntegrity('pkg', bytes, sri('sha256', bytes), undefined)).toEqual({ ok: true })
  })

  test('rejects a mismatched integrity with structured failure', () => {
    const result = verifyTarballIntegrity('pkg', bytes, sri('sha512', new Uint8Array([1])), undefined)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('integrity-mismatch')
    if (result.reason !== 'integrity-mismatch') expect.unreachable()
    expect(result.algo).toBe('sha512')
    expect(result.packageName).toBe('pkg')
  })

  test('rejects an unsupported algorithm with structured failure', () => {
    const result = verifyTarballIntegrity('pkg', bytes, 'md5-abc', undefined)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('integrity-unsupported-algo')
  })

  test('accepts shasum fallback when SRI is absent', () => {
    const shasum = createHash('sha1').update(bytes).digest('hex')
    expect(verifyTarballIntegrity('pkg', bytes, undefined, shasum)).toEqual({ ok: true })
  })

  test('rejects a wrong shasum with structured failure', () => {
    const result = verifyTarballIntegrity('pkg', bytes, undefined, 'deadbeef')
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('integrity-shasum-mismatch')
    if (result.reason !== 'integrity-shasum-mismatch') expect.unreachable()
    expect(result.expected).toBe('deadbeef')
  })

  test('rejects when both integrity and shasum are missing', () => {
    const result = verifyTarballIntegrity('pkg', bytes, undefined, undefined)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('integrity-missing')
  })
})

describe('assertInsideTempDir — tar-slip defense', () => {
  const tempDir = '/tmp/facet-npm-test'

  test('accepts a normal nested path', () => {
    expect(assertInsideTempDir(tempDir, join(tempDir, 'sub/file.js'), 'pkg', 'package/sub/file.js')).toEqual({
      ok: true,
    })
  })

  test('accepts the tempDir itself at depth 0', () => {
    expect(assertInsideTempDir(tempDir, join(tempDir, 'file.js'), 'pkg', 'package/file.js')).toEqual({
      ok: true,
    })
  })

  test('rejects a parent-escape via `..`', () => {
    // Simulate what `join(tempDir, '../../etc/passwd')` would produce.
    const result = assertInsideTempDir(tempDir, '/etc/passwd', 'pkg', 'package/../../etc/passwd')
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('tar-slip')
    expect(result.entryName).toBe('package/../../etc/passwd')
  })

  test('rejects a sibling-directory escape', () => {
    const result = assertInsideTempDir(tempDir, '/tmp/other-dir/file', 'pkg', 'package/../other-dir/file')
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('tar-slip')
  })
})
