import { describe, expect, test } from 'bun:test'
import {
  emptyFacetsJson,
  parseFacetsJson,
  removeFacetFromManifest,
  serializeFacetsJson,
  upsertFacetInManifest,
} from '../manifest/mutations.ts'

describe('parseFacetsJson', () => {
  test('valid facets.json parses and validates', () => {
    const raw = JSON.stringify({
      facets: {
        'viper-plans': 'github:agent-facets/viper-plans#main',
      },
    })
    const result = parseFacetsJson(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.facets['viper-plans']).toBe('github:agent-facets/viper-plans#main')
    }
  })

  test('empty facets object is valid', () => {
    const result = parseFacetsJson('{"facets": {}}')
    expect(result.ok).toBe(true)
  })

  test('malformed JSON returns a parse error', () => {
    const result = parseFacetsJson('{not valid')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain('syntax error')
    }
  })

  test('shape mismatch returns a validation error', () => {
    const result = parseFacetsJson('{"other": {}}')
    expect(result.ok).toBe(false)
  })

  test('non-string source value is rejected', () => {
    const raw = JSON.stringify({ facets: { 'viper-plans': { source: 'github:a/b' } } })
    const result = parseFacetsJson(raw)
    expect(result.ok).toBe(false)
  })
})

describe('serializeFacetsJson', () => {
  test('round-trips basic shape', () => {
    const parsed = parseFacetsJson('{"facets": {"viper-plans": "github:x/y#main"}}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const serialized = serializeFacetsJson(parsed.data)
      expect(serialized).toContain('"viper-plans"')
      expect(serialized).toContain('"github:x/y#main"')
    }
  })

  test('preserves comments on keys not being mutated', () => {
    const raw = `{
  // top-level comment
  "facets": {
    // before viper-plans
    "viper-plans": "github:x/y#main"
  }
}`
    const parsed = parseFacetsJson(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const serialized = serializeFacetsJson(parsed.data)
      expect(serialized).toContain('top-level comment')
      expect(serialized).toContain('before viper-plans')
    }
  })
})

describe('emptyFacetsJson', () => {
  test('returns a valid skeleton', () => {
    const empty = emptyFacetsJson()
    expect(empty).toEqual({ facets: {} })
  })
})

describe('upsertFacetInManifest', () => {
  test('adds a new facet entry', () => {
    const json = emptyFacetsJson()
    upsertFacetInManifest(json, 'viper-plans', 'github:a/b#main')
    expect(json.facets['viper-plans']).toBe('github:a/b#main')
  })

  test('replaces an existing facet entry', () => {
    const parsed = parseFacetsJson('{"facets": {"viper-plans": "github:old/source#main"}}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      upsertFacetInManifest(parsed.data, 'viper-plans', 'github:new/source#v2')
      expect(parsed.data.facets['viper-plans']).toBe('github:new/source#v2')
    }
  })

  test('preserves comments on sibling entries after upsert', () => {
    const raw = `{
  "facets": {
    // keep this comment
    "alpha": "github:a/alpha#main"
  }
}`
    const parsed = parseFacetsJson(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      upsertFacetInManifest(parsed.data, 'beta', 'github:b/beta#main')
      const serialized = serializeFacetsJson(parsed.data)
      expect(serialized).toContain('keep this comment')
      expect(serialized).toContain('"beta"')
    }
  })
})

describe('removeFacetFromManifest', () => {
  test('removes an existing facet entry', () => {
    const parsed = parseFacetsJson('{"facets": {"viper-plans": "github:a/b#main"}}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      removeFacetFromManifest(parsed.data, 'viper-plans')
      expect(parsed.data.facets['viper-plans']).toBeUndefined()
    }
  })

  test('is idempotent when entry is absent', () => {
    const json = emptyFacetsJson()
    removeFacetFromManifest(json, 'nonexistent')
    expect(json.facets).toEqual({})
  })

  test('preserves comments on sibling entries after removal', () => {
    const raw = `{
  "facets": {
    // keep this comment
    "alpha": "github:a/alpha#main",
    "beta": "github:b/beta#main"
  }
}`
    const parsed = parseFacetsJson(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      removeFacetFromManifest(parsed.data, 'beta')
      const serialized = serializeFacetsJson(parsed.data)
      expect(serialized).toContain('keep this comment')
      expect(serialized).not.toContain('"beta"')
    }
  })
})
