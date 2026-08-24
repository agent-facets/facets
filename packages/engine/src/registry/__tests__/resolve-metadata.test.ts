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
import type { RegistrySpec } from '../types.ts'

const VALID = {
  name: 'cowsay',
  version: '0.0.1',
  content_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  content_integrity: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
}

/** The request `VALID` is the response to. */
const REQUESTED: RegistrySpec = {
  name: 'cowsay',
  version: { kind: 'exact', major: 0, minor: 0, patch: 1 },
}

describe('metadataFromWire — runtime guard on the two hash fields', () => {
  test('maps a conforming body to domain-explicit names', () => {
    const result = metadataFromWire(VALID, REQUESTED)
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
    const result = metadataFromWire(stale, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('content_integrity')
    expect(result.error.cause).toContain('cowsay@0.0.1')
  })

  test('fails closed when content_integrity is an empty string', () => {
    const result = metadataFromWire({ ...VALID, content_integrity: '' }, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test('fails closed when content_hash is missing', () => {
    const stale = { ...VALID, content_hash: undefined } as unknown as typeof VALID
    const result = metadataFromWire(stale, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('content_hash')
  })

  test('fails closed when a hash field is a non-string value', () => {
    const mangled = { ...VALID, content_integrity: 42 } as unknown as typeof VALID
    const result = metadataFromWire(mangled, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })
})

describe('metadataFromWire — checking the response against the request', () => {
  test('refuses a body describing a different facet', () => {
    const result = metadataFromWire({ ...VALID, name: 'not-cowsay' }, REQUESTED)
    if (result.ok) expect.unreachable()
    if (result.error.code !== 'UNEXPECTED_ERROR') expect.unreachable()
    expect(result.error.cause).toContain('cowsay')
  })

  test('refuses a missing or non-string name', () => {
    const nameless = { ...VALID, name: undefined } as unknown as typeof VALID
    const result = metadataFromWire(nameless, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test.each(['latest', '1.2', '1.*', '', 'v1.0.0'])('refuses the non-exact resolved version %p', (version) => {
    const result = metadataFromWire({ ...VALID, version }, REQUESTED)
    if (result.ok) expect.unreachable()
    expect(result.error.code).toBe('UNEXPECTED_ERROR')
  })

  test('accepts a wildcard request answered with an exact version', () => {
    // The whole point of a wildcard: the server picks. What it picks
    // still has to be a concrete release.
    const result = metadataFromWire(
      { ...VALID, version: '3.1.4' },
      {
        name: 'cowsay',
        version: { kind: 'majorWildcard', major: 3 },
      },
    )
    if (!result.ok) expect.unreachable()
    expect(result.value.version).toBe('3.1.4')
  })

  test('does not check that the version satisfies the request', () => {
    // Range satisfaction is the caller's question, answered in discovery
    // where the authored specifier and its meaning are known.
    const result = metadataFromWire(
      { ...VALID, version: '9.9.9' },
      {
        name: 'cowsay',
        version: { kind: 'majorWildcard', major: 1 },
      },
    )
    expect(result.ok).toBe(true)
  })
})
