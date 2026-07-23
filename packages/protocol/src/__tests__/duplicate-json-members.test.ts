import { describe, expect, test } from 'bun:test'
import { findDuplicateJsonMembers, validateFacetManifest, validateLegacyFacetManifest } from '@agent-facets/protocol'

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
