import { describe, expect, test } from 'bun:test'
import {
  applyDesiredFacets,
  countOverrides,
  emptyProjectManifest,
  type NormalizedFacetEntry,
  parseProjectManifest,
  serializeProjectManifest,
  stripJsonComments,
} from '../manifest/mutations.ts'

const entry = (source: string, overrides?: NormalizedFacetEntry['overrides']): NormalizedFacetEntry => ({
  source,
  overrides,
})

/** Parse, apply a desired set, and serialize — the production write path. */
function roundTrip(raw: string, desired: Record<string, NormalizedFacetEntry>): string {
  const parsed = parseProjectManifest(raw)
  if (!parsed.ok) expect.unreachable()
  applyDesiredFacets(parsed.manifest.document, desired)
  return serializeProjectManifest(parsed.manifest.document)
}

describe('parseProjectManifest', () => {
  test('a legacy unversioned manifest normalizes to compact entries', () => {
    const result = parseProjectManifest('{"facets":{"viper-plans":"github:agent-facets/viper-plans#main"}}')
    if (!result.ok) expect.unreachable()
    expect(result.manifest.loadedVersion).toBe('legacy-unversioned')
    expect(result.manifest.facets['viper-plans']).toEqual({
      source: 'github:agent-facets/viper-plans#main',
      overrides: undefined,
    })
  })

  test('an empty facets object is valid', () => {
    const result = parseProjectManifest('{"facets": {}}')
    if (!result.ok) expect.unreachable()
    expect(result.manifest.facets).toEqual({})
  })

  test('malformed JSON is a structured failure', () => {
    const result = parseProjectManifest('{not valid')
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-json')
  })

  test('a shape mismatch is a structured failure', () => {
    const result = parseProjectManifest('{"other": {}}')
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('schema-violation')
  })

  test('a legacy entry that is not a string is rejected', () => {
    const result = parseProjectManifest('{"facets":{"viper-plans":{"source":"github:a/b"}}}')
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('schema-violation')
  })

  test('a current manifest normalizes compact and expanded entries uniformly', () => {
    const raw = JSON.stringify({
      manifestVersion: 0.1,
      facets: {
        a: '1.*',
        b: {
          source: 'github:a/b#main',
          materialization: { skills: { review: { kind: 'aliased', as: 'b-review' } } },
        },
      },
    })
    const result = parseProjectManifest(raw)
    if (!result.ok) expect.unreachable()
    expect(result.manifest.facets.a?.source).toBe('1.*')
    expect(result.manifest.facets.b?.source).toBe('github:a/b#main')
    expect(result.manifest.facets.b?.overrides?.skills?.review).toEqual({ kind: 'aliased', as: 'b-review' })
  })
})

describe('stripJsonComments', () => {
  test('replaces comment spans with spaces, preserving length', () => {
    const input = '{"a": 1} // trailing'
    const out = stripJsonComments(input)
    expect(out.length).toBe(input.length)
    expect(out.trimEnd()).toBe('{"a": 1}')
  })

  test('preserves newlines inside block comments so line numbers hold', () => {
    const input = '{\n/* one\ntwo */\n"a": 1}'
    const out = stripJsonComments(input)
    expect(out.split('\n').length).toBe(input.split('\n').length)
    expect(JSON.parse(out)).toEqual({ a: 1 })
  })

  test('leaves comment-like text inside strings alone', () => {
    const input = '{"url": "https://example.com/x", "note": "/* not a comment */"}'
    expect(stripJsonComments(input)).toBe(input)
  })

  test('handles an escaped quote without losing string tracking', () => {
    const input = '{"a": "he said \\"//hi\\"", "b": 1}'
    expect(stripJsonComments(input)).toBe(input)
  })

  // The reason spans become spaces rather than being deleted: the member
  // structure must survive so duplicate detection still sees both members.
  test('preserves duplicate members across a comment', () => {
    const out = stripJsonComments('{"a": 1, // note\n"a": 2}')
    expect(out).toContain('"a": 1')
    expect(out).toContain('"a": 2')
  })

  test('tolerates an unterminated block comment', () => {
    expect(stripJsonComments('{"a": 1} /* never closed').trimEnd()).toBe('{"a": 1}')
  })
})

describe('countOverrides', () => {
  test('counts across every asset type', () => {
    expect(countOverrides(undefined)).toBe(0)
    expect(countOverrides({})).toBe(0)
    expect(countOverrides({ skills: {}, commands: {} })).toBe(0)
    expect(
      countOverrides({
        skills: { a: { kind: 'omitted' }, b: { kind: 'omitted' } },
        commands: { c: { kind: 'omitted' } },
      }),
    ).toBe(3)
  })
})

describe('emptyProjectManifest', () => {
  test('starts at the current format version with no facets', () => {
    const manifest = emptyProjectManifest()
    expect(manifest.loadedVersion).toBe(0.1)
    expect(manifest.facets).toEqual({})
    expect(serializeProjectManifest(manifest.document)).toBe('{\n  "manifestVersion": 0.1,\n  "facets": {}\n}\n')
  })
})

describe('applyDesiredFacets — canonical form', () => {
  test('a facet with no overrides is written as a compact string', () => {
    const out = roundTrip('{"facets":{}}', { a: entry('1.*') })
    expect(JSON.parse(out).facets.a).toBe('1.*')
  })

  test('a facet with overrides is written as an expanded entry', () => {
    const out = roundTrip('{"facets":{}}', {
      a: entry('1.*', { skills: { review: { kind: 'omitted' } } }),
    })
    expect(JSON.parse(out).facets.a).toEqual({
      source: '1.*',
      materialization: { skills: { review: { kind: 'omitted' } } },
    })
  })

  // An expanded entry exists only to carry overrides, so removing the last
  // one must collapse it rather than leave an empty object behind.
  test('an expanded entry collapses to a string when its last override is pruned', () => {
    const raw = JSON.stringify({
      manifestVersion: 0.1,
      facets: { a: { source: '1.*', materialization: { skills: { review: { kind: 'omitted' } } } } },
    })
    const out = roundTrip(raw, { a: entry('1.*') })
    expect(JSON.parse(out).facets.a).toBe('1.*')
  })

  test('an entry with only empty override maps collapses too', () => {
    const out = roundTrip('{"facets":{}}', { a: entry('1.*', { skills: {}, commands: {} }) })
    expect(JSON.parse(out).facets.a).toBe('1.*')
  })

  test('removed facets are deleted from the document', () => {
    const out = roundTrip('{"facets":{"a":"1.*","b":"2.*"}}', { a: entry('1.*') })
    expect(JSON.parse(out).facets).toEqual({ a: '1.*' })
  })
})

describe('applyDesiredFacets — version stamping', () => {
  test('a legacy document is stamped with the current version', () => {
    const out = roundTrip('{"facets":{"a":"1.*"}}', { a: entry('1.*') })
    expect(JSON.parse(out).manifestVersion).toBe(0.1)
  })

  test('a current document keeps its version', () => {
    const out = roundTrip('{"manifestVersion":0.1,"facets":{"a":"1.*"}}', { a: entry('1.*') })
    expect(JSON.parse(out).manifestVersion).toBe(0.1)
  })
})

describe('applyDesiredFacets — source updates preserve overrides', () => {
  test('changing a source keeps the entry expanded with its overrides', () => {
    const raw = JSON.stringify({
      manifestVersion: 0.1,
      facets: { a: { source: '1.*', materialization: { commands: { deploy: { kind: 'omitted' } } } } },
    })
    const out = roundTrip(raw, {
      a: entry('2.*', { commands: { deploy: { kind: 'omitted' } } }),
    })
    expect(JSON.parse(out).facets.a).toEqual({
      source: '2.*',
      materialization: { commands: { deploy: { kind: 'omitted' } } },
    })
  })
})

describe('applyDesiredFacets — comment preservation', () => {
  const commented = `{
  // file header
  "facets": {
    // about alpha
    "alpha": "github:a/alpha#main",
    // about beta
    "beta": "github:b/beta#main"
  }
}`

  test('comments survive an unrelated addition', () => {
    const out = roundTrip(commented, {
      alpha: entry('github:a/alpha#main'),
      beta: entry('github:b/beta#main'),
      gamma: entry('github:g/gamma#main'),
    })
    expect(out).toContain('file header')
    expect(out).toContain('about alpha')
    expect(out).toContain('about beta')
    expect(out).toContain('gamma')
  })

  test('comments survive a source update to another entry', () => {
    const out = roundTrip(commented, {
      alpha: entry('github:a/alpha#v2'),
      beta: entry('github:b/beta#main'),
    })
    expect(out).toContain('file header')
    expect(out).toContain('about beta')
    expect(out).toContain('github:a/alpha#v2')
  })

  test('comments survive migration of a legacy document', () => {
    const out = roundTrip(commented, {
      alpha: entry('github:a/alpha#main'),
      beta: entry('github:b/beta#main'),
    })
    expect(out).toContain('file header')
    expect(JSON.parse(stripJsonComments(out)).manifestVersion).toBe(0.1)
  })

  test('comments survive an entry becoming expanded', () => {
    const out = roundTrip(commented, {
      alpha: entry('github:a/alpha#main', { skills: { review: { kind: 'aliased', as: 'a-review' } } }),
      beta: entry('github:b/beta#main'),
    })
    expect(out).toContain('about alpha')
    expect(out).toContain('about beta')
    expect(JSON.parse(stripJsonComments(out)).facets.alpha.materialization.skills.review).toEqual({
      kind: 'aliased',
      as: 'a-review',
    })
  })
})
