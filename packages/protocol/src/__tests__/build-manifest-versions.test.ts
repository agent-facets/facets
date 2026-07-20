import { describe, expect, test } from 'bun:test'
import {
  CurrentBuildManifestSchema,
  FACET_ARCHIVE_VERSION,
  LEGACY_FACET_ARCHIVE_VERSION,
  LegacyBuildManifestSchema,
  parseBuildManifestDocument,
  SUPPORTED_FACET_VERSIONS,
} from '@agent-facets/protocol'
import { type } from 'arktype'

const HASH = `sha256:${'a'.repeat(64)}`

const legacyManifest = {
  facetVersion: 0.1,
  archive: 'archive.tar.gz',
  integrity: HASH,
  assets: { 'skills/review/SKILL.md': HASH },
}

const currentManifest = {
  facetVersion: 0.2,
  archive: 'archive.tar.gz',
  integrity: HASH,
  files: { 'facet.json': HASH, 'skills/review/SKILL.md': HASH, 'README.md': HASH },
}

describe('version constants', () => {
  test('archive format constants are pinned', () => {
    expect(LEGACY_FACET_ARCHIVE_VERSION).toBe(0.1)
    expect(FACET_ARCHIVE_VERSION).toBe(0.2)
    expect(SUPPORTED_FACET_VERSIONS).toEqual([0.1, 0.2])
  })
})

describe('LegacyBuildManifestSchema', () => {
  test('accepts the legacy 0.1 shape', () => {
    expect(LegacyBuildManifestSchema(legacyManifest)).not.toBeInstanceOf(type.errors)
  })

  test('rejects a non-0.1 facetVersion', () => {
    expect(LegacyBuildManifestSchema({ ...legacyManifest, facetVersion: 0.2 })).toBeInstanceOf(type.errors)
  })

  test('rejects a current-format files map', () => {
    expect(LegacyBuildManifestSchema({ ...legacyManifest, files: { 'facet.json': HASH } })).toBeInstanceOf(type.errors)
  })
})

describe('CurrentBuildManifestSchema', () => {
  test('accepts the current 0.2 shape', () => {
    expect(CurrentBuildManifestSchema(currentManifest)).not.toBeInstanceOf(type.errors)
  })

  test('rejects a non-0.2 facetVersion', () => {
    expect(CurrentBuildManifestSchema({ ...currentManifest, facetVersion: 0.1 })).toBeInstanceOf(type.errors)
  })

  test('rejects a non-canonical archive entry name', () => {
    expect(CurrentBuildManifestSchema({ ...currentManifest, archive: 'payload.tar.gz' })).toBeInstanceOf(type.errors)
  })

  test('rejects a legacy assets map', () => {
    expect(CurrentBuildManifestSchema({ ...currentManifest, assets: { 'facet.json': HASH } })).toBeInstanceOf(
      type.errors,
    )
  })

  test('rejects malformed file-hash values', () => {
    expect(CurrentBuildManifestSchema({ ...currentManifest, files: { 'facet.json': 'md5:abc' } })).toBeInstanceOf(
      type.errors,
    )
  })

  test('rejects a missing files map', () => {
    const { files: _files, ...withoutFiles } = currentManifest
    expect(CurrentBuildManifestSchema(withoutFiles)).toBeInstanceOf(type.errors)
  })
})

describe('parseBuildManifestDocument — exact version dispatch', () => {
  test('parses a legacy 0.1 document', () => {
    const result = parseBuildManifestDocument(JSON.stringify(legacyManifest))
    if (!result.ok) expect.unreachable()
    expect(result.data.facetVersion).toBe(0.1)
    if (result.data.facetVersion !== 0.1) expect.unreachable()
    expect(result.data.manifest.assets['skills/review/SKILL.md']).toBe(HASH)
  })

  test('parses a current 0.2 document', () => {
    const result = parseBuildManifestDocument(JSON.stringify(currentManifest))
    if (!result.ok) expect.unreachable()
    expect(result.data.facetVersion).toBe(0.2)
    if (result.data.facetVersion !== 0.2) expect.unreachable()
    expect(result.data.manifest.files['README.md']).toBe(HASH)
  })

  test('accepts bytes input', () => {
    const result = parseBuildManifestDocument(new TextEncoder().encode(JSON.stringify(currentManifest)))
    expect(result.ok).toBe(true)
  })

  test('unsupported version is a structured failure with observed and supported versions', () => {
    const result = parseBuildManifestDocument(JSON.stringify({ ...currentManifest, facetVersion: 0.3 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'unsupported-facet-version') expect.unreachable()
    expect(result.failure.observed).toBe(0.3)
    expect(result.failure.supported).toEqual([0.1, 0.2])
  })

  test('missing facetVersion is unsupported with observed undefined', () => {
    const result = parseBuildManifestDocument(JSON.stringify({ archive: 'archive.tar.gz', integrity: HASH }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'unsupported-facet-version') expect.unreachable()
    expect(result.failure.observed).toBeUndefined()
  })

  test('malformed 0.2 document fails as 0.2 — never reinterpreted as 0.1', () => {
    // Valid legacy shape except it claims 0.2: must fail the 0.2 schema.
    const result = parseBuildManifestDocument(JSON.stringify({ ...legacyManifest, facetVersion: 0.2 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.facetVersion).toBe(0.2)
  })

  test('malformed 0.1 document fails as 0.1 — never reinterpreted as 0.2', () => {
    const result = parseBuildManifestDocument(JSON.stringify({ ...currentManifest, facetVersion: 0.1 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.facetVersion).toBe(0.1)
  })

  test('duplicate JSON members are rejected before schema validation', () => {
    const text = `{"facetVersion":0.2,"archive":"archive.tar.gz","integrity":"${HASH}","files":{"facet.json":"${HASH}"},"files":{"evil.txt":"${HASH}"}}`
    const result = parseBuildManifestDocument(text)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('invalid JSON is a structured failure', () => {
    const result = parseBuildManifestDocument('{not json')
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-json')
  })
})
