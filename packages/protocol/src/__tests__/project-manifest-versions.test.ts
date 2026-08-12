import { describe, expect, test } from 'bun:test'
import {
  CURRENT_LOCKFILE_VERSION,
  CURRENT_PROJECT_MANIFEST_VERSION,
  CurrentProjectManifestSchema,
  facetEntryOverrides,
  facetEntrySource,
  LEGACY_PROJECT_MANIFEST_VERSION,
  LegacyProjectManifestSchema,
  PROJECT_MANIFEST_VERSION_0_1,
  ProjectManifest01Schema,
  parseProjectManifestDocument,
  SUPPORTED_LOCKFILE_VERSIONS,
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
  manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION,
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
    expect(CURRENT_PROJECT_MANIFEST_VERSION).toBe(0.2)
    expect(PROJECT_MANIFEST_VERSION_0_1).toBe(0.1)
    expect(LEGACY_PROJECT_MANIFEST_VERSION).toBe('legacy-unversioned')
    expect(SUPPORTED_PROJECT_MANIFEST_VERSIONS).toEqual([0.1, 0.2])
  })

  test('the project-manifest version is independent of other format axes', () => {
    // `facets.json` versioning is its own axis. It currently shares the value
    // `0.2` with the archive format by coincidence, so the guard is that the
    // constants stay SEPARATE — reading one where the other belongs must not
    // typecheck away silently — rather than that they hold different numbers.
    expect(CURRENT_PROJECT_MANIFEST_VERSION).not.toBe(CURRENT_LOCKFILE_VERSION)
    expect(SUPPORTED_PROJECT_MANIFEST_VERSIONS).not.toEqual(SUPPORTED_LOCKFILE_VERSIONS)
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

  test('rejects any manifestVersion other than the current one', () => {
    expect(CurrentProjectManifestSchema({ ...currentManifest, manifestVersion: 0.1 })).toBeInstanceOf(type.errors)
    expect(CurrentProjectManifestSchema({ ...currentManifest, manifestVersion: 0.3 })).toBeInstanceOf(type.errors)
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

  test('accepts the servers override group', () => {
    expect(CurrentProjectManifestSchema(expanded({ servers: { db: { kind: 'omitted' } } }))).not.toBeInstanceOf(
      type.errors,
    )
    expect(
      CurrentProjectManifestSchema(expanded({ servers: { db: { kind: 'aliased', as: 'project-db' } } })),
    ).not.toBeInstanceOf(type.errors)
  })

  test('rejects an unknown override group', () => {
    expect(CurrentProjectManifestSchema(expanded({ serverz: { db: { kind: 'omitted' } } }))).toBeInstanceOf(type.errors)
  })

  test('rejects a server override key outside the declaration grammar', () => {
    // Server declarations have only ever existed under the single-segment
    // grammar, so a key outside it could not name a real server.
    expect(CurrentProjectManifestSchema(expanded({ servers: { Bad_Name: { kind: 'omitted' } } }))).toBeInstanceOf(
      type.errors,
    )
  })

  // The test above passed for the wrong reason before undeclared groups were
  // rejected: with no recognized group present, the "at least one override"
  // narrow failed instead. A misspelling BESIDE a valid group is the case
  // that actually silently discarded intent.
  test('rejects an unknown group declared alongside a valid one', () => {
    const input = expanded({
      skills: { review: { kind: 'omitted' } },
      skillz: { deploy: { kind: 'omitted' } },
    })
    expect(CurrentProjectManifestSchema(input)).toBeInstanceOf(type.errors)
  })

  test('an empty override object is still rejected for its own reason', () => {
    // Distinct from the undeclared-group rejection: this one has no groups
    // at all, so an expanded entry is a second spelling of the compact form.
    expect(CurrentProjectManifestSchema(expanded({}))).toBeInstanceOf(type.errors)
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

  test('parses a current document', () => {
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

  test('a malformed current document fails as current and is never retried as legacy', () => {
    const input = {
      manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION,
      facets: { 'facet-b': { source: 'github:a/b', materialization: {} } },
    }
    const result = parseProjectManifestDocument(JSON.stringify(input))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.manifestVersion).toBe(CURRENT_PROJECT_MANIFEST_VERSION)
  })

  test('a 0.1 document is read under the frozen 0.1 schema', () => {
    const result = parseProjectManifestDocument(JSON.stringify({ manifestVersion: 0.1, facets: { a: '1.*' } }))
    if (!result.ok) expect.unreachable()
    expect(result.data.manifestVersion).toBe(PROJECT_MANIFEST_VERSION_0_1)
  })

  test('a 0.1 document declaring server overrides is rejected, never promoted', () => {
    const input = {
      manifestVersion: 0.1,
      facets: { a: { source: '1.*', materialization: { servers: { fs: { kind: 'omitted' } } } } },
    }
    const result = parseProjectManifestDocument(JSON.stringify(input))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.manifestVersion).toBe(PROJECT_MANIFEST_VERSION_0_1)
  })

  test('the frozen 0.1 schema still accepts asset overrides', () => {
    const input = {
      manifestVersion: 0.1,
      facets: { a: { source: '1.*', materialization: { skills: { review: { kind: 'omitted' } } } } },
    }
    expect(ProjectManifest01Schema(input)).not.toBeInstanceOf(type.errors)
  })

  test('an unsupported version is a structured failure', () => {
    const result = parseProjectManifestDocument(JSON.stringify({ ...legacyManifest, manifestVersion: 0.3 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'unsupported-manifest-version') expect.unreachable()
    expect(result.failure.observed).toBe(0.3)
    expect(result.failure.supported).toEqual([0.1, 0.2])
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
    const text = '{"manifestVersion":0.2,"facets":{"a":"1.*"},"facets":{"b":"2.*"}}'
    const result = parseProjectManifestDocument(text)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('a duplicate override key is rejected', () => {
    const text =
      '{"manifestVersion":0.2,"facets":{"b":{"source":"github:a/b","materialization":' +
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
