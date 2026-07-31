import { afterEach, describe, expect, test } from 'bun:test'
import { mergeDeltaIntoManifest } from '../install/commit/delta.ts'
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

// A facet key is an arbitrary string from a user-authored file. Assigning an
// own `__proto__` key into a plain `{}` invokes the inherited setter instead
// of creating a property, so the declaration vanished — and a vanished facet
// reads as REMOVED, which would delete its locked assets and commit a
// manifest without it. It must survive to ordinary name validation instead.
describe('facet keys that collide with Object.prototype', () => {
  // Written as text, not built from an object literal: `{ __proto__: … }` in
  // JS source sets the prototype rather than creating a member, so a literal
  // could not express the document under test. `JSON.parse` DOES create an
  // own `__proto__` property, which is exactly why the key reaches us.
  const raw = '{"manifestVersion":0.1,"facets":{"__proto__":"./vendor/x","constructor":"./vendor/y","ok":"1.*"}}'

  test('an own __proto__ declaration survives normalization', () => {
    const result = parseProjectManifest(raw)
    if (!result.ok) expect.unreachable()

    expect(Object.hasOwn(result.manifest.facets, '__proto__')).toBe(true)
    expect(Object.keys(result.manifest.facets).sort()).toEqual(['__proto__', 'constructor', 'ok'])
    expect(Object.getPrototypeOf(result.manifest.facets)).toBeNull()
  })

  test('a constructor declaration is the declaration, not an inherited function', () => {
    const result = parseProjectManifest(raw)
    if (!result.ok) expect.unreachable()
    // Held in a variable rather than written as a literal key: reading
    // `facets.constructor` resolves to `Object`'s at the type level too,
    // which is the same hazard in a different guise.
    const facetName = 'constructor'
    expect(result.manifest.facets[facetName]).toEqual({ source: './vendor/y', overrides: undefined })
  })

  // The fix has to hold one hop later too: the desired set is rebuilt
  // key-by-key before anything is resolved.
  test('the merged desired set carries both keys through', () => {
    const result = parseProjectManifest(raw)
    if (!result.ok) expect.unreachable()

    const merged = mergeDeltaIntoManifest(result.manifest.facets, { additions: [], removals: [] })

    expect(Object.keys(merged.desiredFacets).sort()).toEqual(['__proto__', 'constructor', 'ok'])
  })
})

// The last hop, and the one that bites hardest: the WRITE side.
//
// Reading a `__proto__` key off the live comment-json document returns
// `Object.prototype` — an object, so the "update this node in place" branch
// accepted it and assigned `source`, `materialization`, `kind`, and `as`
// onto the prototype every object in the process inherits from. The write
// itself was equally unsafe: assignment for that key creates no own member,
// so the facet disappeared from the serialized manifest while its assets
// stayed on disk, claimed by a lockfile entry nothing declared any more.
describe('applyDesiredFacets — document keys that collide with Object.prototype', () => {
  const POLLUTED_KEYS = ['source', 'materialization', 'kind', 'as'] as const

  // Restored rather than merely asserted: a regression here would otherwise
  // leak into every sibling test in the process.
  afterEach(() => {
    for (const key of POLLUTED_KEYS) {
      if (Object.hasOwn(Object.prototype, key)) {
        delete (Object.prototype as Record<string, unknown>)[key]
      }
    }
  })

  function pollutedKeys(): string[] {
    return POLLUTED_KEYS.filter((key) => Object.hasOwn(Object.prototype, key))
  }

  /**
   * A record with an own `__proto__` member. `{ __proto__: v }` in JS source
   * sets the prototype instead, so the desired set has to be built the same
   * way the production one is: key by key, never as a literal.
   */
  function withProtoKey<T>(value: T, rest: Record<string, T> = {}): Record<string, T> {
    const record: Record<string, T> = { ...rest }
    Object.defineProperty(record, '__proto__', { value, enumerable: true, writable: true, configurable: true })
    return record
  }

  test('a __proto__ facet is written as an own member, not onto the prototype', () => {
    const raw = '{"manifestVersion":0.1,"facets":{"__proto__":"./vendor/x","ok":"1.*"}}'
    const parsed = parseProjectManifest(raw)
    if (!parsed.ok) expect.unreachable()

    applyDesiredFacets(
      parsed.manifest.document,
      withProtoKey(entry('./vendor/x', { skills: { review: { kind: 'aliased', as: 'vendor-review' } } }), {
        ok: entry('1.*'),
      }),
    )

    expect(pollutedKeys()).toEqual([])
    const serialized = JSON.parse(serializeProjectManifest(parsed.manifest.document))
    expect(Object.hasOwn(serialized.facets, '__proto__')).toBe(true)
  })

  test('a __proto__ override name is written as an own member', () => {
    const raw =
      '{"manifestVersion":0.1,"facets":{"vendor":{"source":"./vendor/x","materialization":{"skills":{"other":{"kind":"omitted"}}}}}}'
    const parsed = parseProjectManifest(raw)
    if (!parsed.ok) expect.unreachable()

    // An asset genuinely named `__proto__` can reach here: lockfile asset
    // names are validated for path safety only, and a removal-only
    // refinement plans over the LOCKED asset set without ever resolving.
    applyDesiredFacets(parsed.manifest.document, {
      vendor: entry('./vendor/x', { skills: withProtoKey({ kind: 'aliased', as: 'safe' } as const) }),
    })

    expect(pollutedKeys()).toEqual([])
    const serialized = JSON.parse(serializeProjectManifest(parsed.manifest.document))
    expect(Object.hasOwn(serialized.facets.vendor.materialization.skills, '__proto__')).toBe(true)
  })

  // The guard must not over-reject: `constructor` reads back as a function
  // rather than an object, so the replace branch is correct for it — but the
  // entry still has to land, and its comments still have to survive when the
  // intent is unchanged.
  test('a constructor facet keeps its comments when nothing changed', () => {
    const raw = '{"manifestVersion":0.1,"facets":{\n// keep me\n"constructor":"./vendor/y"}}'
    const parsed = parseProjectManifest(raw)
    if (!parsed.ok) expect.unreachable()

    applyDesiredFacets(parsed.manifest.document, { constructor: entry('./vendor/y') })

    const serialized = serializeProjectManifest(parsed.manifest.document)
    expect(serialized).toContain('keep me')
    expect(serialized).toContain('"constructor": "./vendor/y"')
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

  // Comments INSIDE a `materialization` block died on every routine install:
  // the whole subtree was reassigned, and comment-json keeps its metadata on
  // Symbol-keyed properties of the object being replaced. The intent map is
  // rebuilt from scratch on every run, so identity comparison cannot detect
  // "unchanged" — only comparing by value can.
  describe('nested materialization comments', () => {
    const annotated = `{
  "manifestVersion": 0.1,
  "facets": {
    "alpha": {
      "source": "1.*",
      // why we alias
      "materialization": {
        "skills": {
          // renamed to avoid the vendor clash
          "review": { "kind": "aliased", "as": "vendor-review" },
          // dropped: superseded internally
          "deploy": { "kind": "omitted" }
        }
      }
    }
  }
}`

    const alias = (as: string) => ({ kind: 'aliased' as const, as })

    test('unchanged intent leaves the block byte-identical', () => {
      const desired = {
        alpha: entry('1.*', { skills: { review: alias('vendor-review'), deploy: { kind: 'omitted' } } }),
      }
      // Baseline is a parse+serialize round trip, not the raw fixture: the
      // serializer normalizes layout regardless of this change, so comparing
      // against the source would fail for an unrelated reason.
      const parsed = parseProjectManifest(annotated)
      if (!parsed.ok) expect.unreachable()
      const baseline = serializeProjectManifest(parsed.manifest.document)

      expect(roundTrip(annotated, desired)).toBe(baseline)
    })

    test('retargeting one alias keeps every nested comment', () => {
      const out = roundTrip(annotated, {
        alpha: entry('1.*', { skills: { review: alias('team-review'), deploy: { kind: 'omitted' } } }),
      })
      expect(out).toContain('why we alias')
      expect(out).toContain('renamed to avoid the vendor clash')
      expect(out).toContain('dropped: superseded internally')
      expect(JSON.parse(stripJsonComments(out)).facets.alpha.materialization.skills.review).toEqual(
        alias('team-review'),
      )
    })

    test('pruning one override keeps the other and drops the pruned note', () => {
      const out = roundTrip(annotated, {
        alpha: entry('1.*', { skills: { review: alias('vendor-review') } }),
      })
      expect(out).toContain('renamed to avoid the vendor clash')
      expect(out).not.toContain('dropped: superseded internally')
      expect(JSON.parse(stripJsonComments(out)).facets.alpha.materialization.skills).toEqual({
        review: alias('vendor-review'),
      })
    })

    test('changing an alias to an omission leaves no stray effective name', () => {
      const out = roundTrip(annotated, {
        alpha: entry('1.*', { skills: { review: { kind: 'omitted' }, deploy: { kind: 'omitted' } } }),
      })
      expect(out).toContain('renamed to avoid the vendor clash')
      const written = JSON.parse(stripJsonComments(out)).facets.alpha.materialization.skills.review
      expect(written).toEqual({ kind: 'omitted' })
      expect('as' in written).toBe(false)
    })

    test('an emptied group is removed rather than left as an empty object', () => {
      const out = roundTrip(annotated, {
        alpha: entry('1.*', { commands: { ship: { kind: 'omitted' } } }),
      })
      const materialization = JSON.parse(stripJsonComments(out)).facets.alpha.materialization
      expect(materialization).toEqual({ commands: { ship: { kind: 'omitted' } } })
    })
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
