/**
 * Tests for the wire→internal metadata mapping guard (W4).
 *
 * The generated OpenAPI types declare `content_hash` and
 * `content_integrity` as required strings, but `openapi-fetch` performs
 * no response validation — a stale CDN-cached pre-migration metadata
 * object can deserialize with either field missing. The mapping must
 * fail closed (structured contract violation), never propagate
 * `undefined` into the integrity chain, and never fall back to the
 * other hash.
 */

import { describe, expect, test } from 'bun:test'
import { metadataFromWire } from '../resolve-metadata.ts'

const VALID = {
  name: 'cowsay',
  version: '0.0.1',
  content_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  content_integrity: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
}

describe('metadataFromWire — runtime guard on the two hash fields', () => {
  test('maps a conforming body to domain-explicit names', () => {
    const result = metadataFromWire(VALID)
    if (!result.ok) expect.unreachable()
    expect(result.value).toEqual({
      name: 'cowsay',
      version: '0.0.1',
      transportHash: VALID.content_hash,
      contentFingerprint: VALID.content_integrity,
    })
  })

  test('fails closed when content_integrity is missing (stale CDN shape)', () => {
    const stale = { ...VALID, content_integrity: undefined } as unknown as typeof VALID
    const result = metadataFromWire(stale)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('content_integrity')
    expect(result.error.cause).toContain('cowsay@0.0.1')
  })

  test('fails closed when content_integrity is an empty string', () => {
    const result = metadataFromWire({ ...VALID, content_integrity: '' })
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test('fails closed when content_hash is missing', () => {
    const stale = { ...VALID, content_hash: undefined } as unknown as typeof VALID
    const result = metadataFromWire(stale)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('content_hash')
  })

  test('fails closed when a hash field is a non-string value', () => {
    const mangled = { ...VALID, content_integrity: 42 } as unknown as typeof VALID
    const result = metadataFromWire(mangled)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })
})
