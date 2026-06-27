import { describe, expect, test } from 'bun:test'
import { type FacetManifest, resolvePromptsFromMap } from '@agent-facets/protocol'

// Minimal validated manifest factory. `resolvePromptsFromMap` consumes an
// already-validated FacetManifest, so we construct the shape directly and only
// vary the `private` field under test.
function manifestWith(overrides: Partial<FacetManifest>): FacetManifest {
  return {
    name: 'my-facet',
    version: '1.0.0',
    skills: { 'code-review': { description: 'Reviews code' } },
    ...overrides,
  } as FacetManifest
}

const contentByPath = { 'skills/code-review/SKILL.md': '# Review' }

describe('resolvePromptsFromMap — privacy preservation', () => {
  test('preserves private: true', () => {
    const result = resolvePromptsFromMap(manifestWith({ private: true }), contentByPath)
    if (!result.ok) expect.unreachable()
    expect(result.data.private).toBe(true)
  })

  test('preserves private: false', () => {
    const result = resolvePromptsFromMap(manifestWith({ private: false }), contentByPath)
    if (!result.ok) expect.unreachable()
    expect(result.data.private).toBe(false)
  })

  test('does not synthesize private when omitted', () => {
    const result = resolvePromptsFromMap(manifestWith({}), contentByPath)
    if (!result.ok) expect.unreachable()
    expect('private' in result.data).toBe(false)
    expect(result.data.private).toBeUndefined()
  })
})
