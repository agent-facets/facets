import { describe, expect, test } from 'bun:test'
import {
  findDuplicateJsonMembers,
  parseLockfileDocument,
  validateFacetManifest,
  validateLegacyFacetManifest,
} from '@agent-facets/protocol'

describe('findDuplicateJsonMembers', () => {
  test('clean document has no duplicates', () => {
    expect(findDuplicateJsonMembers('{"a":1,"b":{"c":2},"d":[{"e":3}]}')).toEqual([])
  })

  test('top-level duplicate is detected', () => {
    const errors = findDuplicateJsonMembers('{"files":{},"files":{}}')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('"files"')
  })

  test('nested duplicate reports the enclosing path', () => {
    const errors = findDuplicateJsonMembers('{"facets":{"cowsay":{"version":"1.0.0","version":"2.0.0"}}}')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.path).toBe('facets.cowsay')
  })

  test('duplicate inside an array element object is detected', () => {
    const errors = findDuplicateJsonMembers('{"assets":[{"name":"a","name":"b"}]}')
    expect(errors).toHaveLength(1)
  })

  test('escaped keys are decoded before comparison', () => {
    // "\u0066iles" decodes to "files".
    const errors = findDuplicateJsonMembers('{"files":{},"\\u0066iles":{}}')
    expect(errors).toHaveLength(1)
  })

  test('same key in sibling objects is not a duplicate', () => {
    expect(findDuplicateJsonMembers('{"a":{"x":1},"b":{"x":2}}')).toEqual([])
  })

  test('string values containing braces and quotes do not confuse the scanner', () => {
    expect(findDuplicateJsonMembers('{"a":"{\\"a\\":1,\\"a\\":2}","b":"}{"}')).toEqual([])
  })
})

describe('facet-manifest validators reject duplicate members', () => {
  test('current validator rejects duplicate top-level members', () => {
    const text = '{"name":"ok","version":"1.0.0","skills":{"a":{"description":"x"}},"skills":{"b":{"description":"y"}}}'
    const result = validateFacetManifest(text)
    if (result.ok) expect.unreachable()
    expect(result.errors[0]?.message).toContain('Duplicate JSON object member')
  })

  test('legacy validator rejects duplicate members too', () => {
    const text = '{"name":"ok","version":"1.0.0","agents":{"a":{"description":"x"}},"agents":{"a":{"description":"x"}}}'
    const result = validateLegacyFacetManifest(text)
    if (result.ok) expect.unreachable()
    expect(result.errors[0]?.message).toContain('Duplicate JSON object member')
  })
})

describe('lockfile 0.4 server records reject duplicate members before schema validation', () => {
  const FP = `sha256:${'a'.repeat(64)}`
  const OTHER = `sha256:${'b'.repeat(64)}`

  function document(serverJson: string): string {
    return `{"lockfileVersion":0.4,"facets":{"cowsay":{"source":{"kind":"local","path":"."},"version":"1.0.0","integrity":"x","assets":[],"servers":[${serverJson}]}}}`
  }

  test('a duplicated fingerprint member is rejected, not resolved last-wins', () => {
    const result = parseLockfileDocument(
      document(`{"name":"fs","fingerprint":"${FP}","fingerprint":"${OTHER}","materialization":{"kind":"authored"}}`),
    )
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('a duplicated member inside a nested disposition is rejected', () => {
    const result = parseLockfileDocument(
      document(`{"name":"fs","fingerprint":"${FP}","materialization":{"kind":"aliased","as":"a","as":"b"}}`),
    )
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('an escaped spelling of a member name is still a duplicate', () => {
    // "\u006eame" decodes to "name".
    const result = parseLockfileDocument(
      document(`{"name":"fs","\\u006eame":"other","fingerprint":"${FP}","materialization":{"kind":"authored"}}`),
    )
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('duplicate detection precedes schema validation', () => {
    // Also schema-invalid (bad name), but the duplicate is what is reported.
    const result = parseLockfileDocument(
      document(`{"name":"Bad_Name","name":"Bad_Name","fingerprint":"${FP}","materialization":{"kind":"authored"}}`),
    )
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('the same document without duplicates parses', () => {
    const result = parseLockfileDocument(
      document(`{"name":"fs","fingerprint":"${FP}","materialization":{"kind":"authored"}}`),
    )
    expect(result.ok).toBe(true)
  })
})
