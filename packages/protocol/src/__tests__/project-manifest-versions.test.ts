import { describe, expect, test } from 'bun:test'
import {
  CURRENT_PROJECT_MANIFEST_VERSION,
  CurrentProjectManifestSchema,
  facetEntryOverrides,
  facetEntrySource,
  LEGACY_PROJECT_MANIFEST_VERSION,
  LegacyProjectManifestSchema,
  parseProjectManifestDocument,
  SUPPORTED_PROJECT_MANIFEST_VERSIONS,
} from '@agent-facets/protocol'
import { type } from 'arktype'

const legacyManifest = {
  facets: {
    'facet-a': '1.*',
    'facet-b': 'github:example/facet-b#main',
  },
}

const currentManifest = {
  manifestVersion: 0.1,
  facets: {
    'facet-a': '1.*',
    'facet-b': {
      source: 'github:example/facet-b#main',
      materialization: {
        skills: { review: { kind: 'aliased', as: 'facet-b-review' } },
        commands: { deploy: { kind: 'omitted' } },
      },
    },
  },
}

/** A current manifest whose sole facet is the given entry. */
const withEntry = (entry: unknown): unknown => ({
  manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION,
  facets: { 'facet-b': entry },
})

describe('project-manifest version constants', () => {
  test('the current version is pinned and legacy is unversioned', () => {
    expect(CURRENT_PROJECT_MANIFEST_VERSION).toBe(0.1)
    expect(LEGACY_PROJECT_MANIFEST_VERSION).toBe('legacy-unversioned')
    expect(SUPPORTED_PROJECT_MANIFEST_VERSIONS).toEqual([0.1])
  })

  test('the project-manifest version is independent of other format axes', () => {
    // `facets.json` versioning shares no value with the archive or lockfile
    // axes; asserting the pin here catches an accidental "align them all".
    expect(CURRENT_PROJECT_MANIFEST_VERSION).not.toBe(0.2)
  })
})

describe('LegacyProjectManifestSchema', () => {
  test('accepts a compact string-only manifest', () => {
    expect(LegacyProjectManifestSchema(legacyManifest)).not.toBeInstanceOf(type.errors)
  })

  test('accepts an empty facets map', () => {
    expect(LegacyProjectManifestSchema({ facets: {} })).not.toBeInstanceOf(type.errors)
  })

  test('rejects an expanded entry', () => {
    const input = { facets: { 'facet-b': { source: 'github:a/b', materialization: {} } } }
    expect(LegacyProjectManifestSchema(input)).toBeInstanceOf(type.errors)
  })

  test('rejects a declared manifestVersion', () => {
    expect(LegacyProjectManifestSchema({ ...legacyManifest, manifestVersion: 0.1 })).toBeInstanceOf(type.errors)
  })

  test('rejects a missing facets map', () => {
    expect(LegacyProjectManifestSchema({})).toBeInstanceOf(type.errors)
  })
})

describe('CurrentProjectManifestSchema — entries', () => {
  test('accepts compact and expanded entries side by side', () => {
    expect(CurrentProjectManifestSchema(currentManifest)).not.toBeInstanceOf(type.errors)
  })

  test('accepts a compact-only current manifest', () => {
    expect(CurrentProjectManifestSchema(withEntry('1.*'))).not.toBeInstanceOf(type.errors)
  })

  test('rejects a non-0.1 manifestVersion', () => {
    expect(CurrentProjectManifestSchema({ ...currentManifest, manifestVersion: 0.2 })).toBeInstanceOf(type.errors)
  })

  test('rejects an expanded entry without a source', () => {
    const entry = { materialization: { skills: { review: { kind: 'omitted' } } } }
    expect(CurrentProjectManifestSchema(withEntry(entry))).toBeInstanceOf(type.errors)
  })

  test('rejects an expanded entry without a materialization object', () => {
    expect(CurrentProjectManifestSchema(withEntry({ source: 'github:a/b' }))).toBeInstanceOf(type.errors)
  })

  // An expanded entry exists only to carry overrides; an empty one is a
  // second spelling of the compact form.
  test('rejects an expanded entry declaring no overrides', () => {
    const entry = { source: 'github:a/b', materialization: {} }
    expect(CurrentProjectManifestSchema(withEntry(entry))).toBeInstanceOf(type.errors)
  })

  test('rejects an expanded entry whose override maps are all empty', () => {
    const entry = { source: 'github:a/b', materialization: { skills: {}, commands: {} } }
    expect(CurrentProjectManifestSchema(withEntry(entry))).toBeInstanceOf(type.errors)
  })
})

describe('CurrentProjectManifestSchema — typed override maps', () => {
  const expanded = (materialization: unknown): unknown => withEntry({ source: 'github:a/b', materialization })

  test('accepts overrides on each asset type', () => {
    expect(CurrentProjectManifestSchema(expanded({ skills: { review: { kind: 'omitted' } } }))).not.toBeInstanceOf(
      type.errors,
    )
    expect(CurrentProjectManifestSchema(expanded({ agents: { reviewer: { kind: 'omitted' } } }))).not.toBeInstanceOf(
      type.errors,
    )
    expect(CurrentProjectManifestSchema(expanded({ commands: { deploy: { kind: 'omitted' } } }))).not.toBeInstanceOf(
      type.errors,
    )
  })

  test('rejects an explicit authored override', () => {
    // Absence of an override already means authored materialization.
    expect(CurrentProjectManifestSchema(expanded({ skills: { review: { kind: 'authored' } } }))).toBeInstanceOf(
      type.errors,
    )
  })

  test('rejects an unknown asset-type group', () => {
    expect(CurrentProjectManifestSchema(expanded({ servers: { db: { kind: 'omitted' } } }))).toBeInstanceOf(type.errors)
  })

  test.each(['Review', 'review/code', '-review', 'double--hyphen', ''])('rejects invalid alias %p', (alias) => {
    const input = expanded({ skills: { review: { kind: 'aliased', as: alias } } })
    expect(CurrentProjectManifestSchema(input)).toBeInstanceOf(type.errors)
  })

  test('rejects an aliased override with no target', () => {
    expect(CurrentProjectManifestSchema(expanded({ skills: { review: { kind: 'aliased' } } }))).toBeInstanceOf(
      type.errors,
    )
  })

  // Authored keys use the path-safety guard, not the stricter single-segment
  // grammar: a project must stay able to address an asset published by an
  // older, more permissive facet format.
  test('accepts a legacy slash-namespaced authored key', () => {
    const input = expanded({ skills: { 'acme/review': { kind: 'omitted' } } })
    expect(CurrentProjectManifestSchema(input)).not.toBeInstanceOf(type.errors)
  })

  test.each(['../escape', 'a/../b', 'a\\b', ''])('rejects unsafe authored key %p', (key) => {
    const input = expanded({ skills: { [key]: { kind: 'omitted' } } })
    expect(CurrentProjectManifestSchema(input)).toBeInstanceOf(type.errors)
  })

  // Document validation never resolves a facet, so an override naming an
  // asset the resolved version does not contain is still schema-valid.
  test('an override naming an absent asset is still valid', () => {
    const input = expanded({ skills: { 'never-published': { kind: 'omitted' } } })
    expect(CurrentProjectManifestSchema(input)).not.toBeInstanceOf(type.errors)
  })
})

describe('parseProjectManifestDocument — exact version dispatch', () => {
  test('parses a legacy unversioned document', () => {
    const result = parseProjectManifestDocument(JSON.stringify(legacyManifest))
    if (!result.ok) expect.unreachable()
    if (result.data.manifestVersion !== LEGACY_PROJECT_MANIFEST_VERSION) expect.unreachable()
    expect(result.data.manifest.facets['facet-a']).toBe('1.*')
  })

  test('parses a current 0.1 document', () => {
    const result = parseProjectManifestDocument(JSON.stringify(currentManifest))
    if (!result.ok) expect.unreachable()
    if (result.data.manifestVersion !== CURRENT_PROJECT_MANIFEST_VERSION) expect.unreachable()
    const entry = result.data.manifest.facets['facet-b']
    if (entry === undefined || typeof entry === 'string') expect.unreachable()
    expect(entry.materialization.skills?.review).toEqual({ kind: 'aliased', as: 'facet-b-review' })
  })

  test('accepts bytes as well as a string', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(currentManifest))
    const result = parseProjectManifestDocument(bytes)
    if (!result.ok) expect.unreachable()
    expect(result.data.manifestVersion).toBe(CURRENT_PROJECT_MANIFEST_VERSION)
  })

  // No shape-sniffing in either direction (design D4).
  test('an expanded entry in an unversioned document fails as legacy', () => {
    const input = { facets: { 'facet-b': { source: 'github:a/b', materialization: {} } } }
    const result = parseProjectManifestDocument(JSON.stringify(input))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.manifestVersion).toBe(LEGACY_PROJECT_MANIFEST_VERSION)
  })

  test('a malformed 0.1 document fails as 0.1 and is never retried as legacy', () => {
    const input = { manifestVersion: 0.1, facets: { 'facet-b': { source: 'github:a/b', materialization: {} } } }
    const result = parseProjectManifestDocument(JSON.stringify(input))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.manifestVersion).toBe(CURRENT_PROJECT_MANIFEST_VERSION)
  })

  test('a compact-only document declaring 0.1 is read as current, not legacy', () => {
    const result = parseProjectManifestDocument(JSON.stringify({ manifestVersion: 0.1, facets: { a: '1.*' } }))
    if (!result.ok) expect.unreachable()
    expect(result.data.manifestVersion).toBe(CURRENT_PROJECT_MANIFEST_VERSION)
  })

  test('an unsupported version is a structured failure', () => {
    const result = parseProjectManifestDocument(JSON.stringify({ ...legacyManifest, manifestVersion: 0.2 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'unsupported-manifest-version') expect.unreachable()
    expect(result.failure.observed).toBe(0.2)
    expect(result.failure.supported).toEqual([0.1])
  })

  test('a non-numeric version is unsupported with no observed number', () => {
    const result = parseProjectManifestDocument(JSON.stringify({ ...legacyManifest, manifestVersion: '0.1' }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'unsupported-manifest-version') expect.unreachable()
    expect(result.failure.observed).toBeUndefined()
  })

  // Two conflicting decisions for one asset must not collapse through
  // last-member-wins parsing.
  test('duplicate members are rejected before version dispatch', () => {
    const text = '{"manifestVersion":0.1,"facets":{"a":"1.*"},"facets":{"b":"2.*"}}'
    const result = parseProjectManifestDocument(text)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('a duplicate override key is rejected', () => {
    const text =
      '{"manifestVersion":0.1,"facets":{"b":{"source":"github:a/b","materialization":' +
      '{"skills":{"review":{"kind":"omitted"},"review":{"kind":"aliased","as":"x"}}}}}}'
    const result = parseProjectManifestDocument(text)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('an unsupported version is reported even with duplicate-free malformed content', () => {
    const result = parseProjectManifestDocument(JSON.stringify({ manifestVersion: 9, facets: 'nope' }))
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('unsupported-manifest-version')
  })

  test('invalid JSON is a structured failure', () => {
    const result = parseProjectManifestDocument('{not valid')
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-json')
  })
})

describe('facet entry accessors', () => {
  test('read a source from either entry form', () => {
    expect(facetEntrySource('1.*')).toBe('1.*')
    expect(
      facetEntrySource({
        source: 'github:a/b',
        materialization: { skills: { review: { kind: 'omitted' } } },
      }),
    ).toBe('github:a/b')
  })

  test('a compact entry declares no overrides', () => {
    expect(facetEntryOverrides('1.*')).toBeUndefined()
  })

  test('an expanded entry exposes its overrides', () => {
    const overrides = facetEntryOverrides({
      source: 'github:a/b',
      materialization: { commands: { deploy: { kind: 'omitted' } } },
    })
    expect(overrides?.commands?.deploy).toEqual({ kind: 'omitted' })
  })
})
