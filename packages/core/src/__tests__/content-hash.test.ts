import { describe, expect, test } from 'bun:test'
import { parseTar, parseTarGzip } from 'nanotar'
import {
  assembleTar,
  collectArchiveEntries,
  compressArchive,
  computeAssetHashes,
  computeContentHash,
} from '../build/content-hash.ts'
import type { ResolvedFacetManifest } from '../loaders/facet.ts'

describe('computeContentHash', () => {
  test('computes correct SHA-256 for string input', () => {
    const hash = computeContentHash('hello world')
    expect(hash).toMatchInlineSnapshot(`"sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"`)
  })

  test('computes correct SHA-256 for Uint8Array input', () => {
    const hash = computeContentHash(new TextEncoder().encode('hello world'))
    expect(hash).toMatchInlineSnapshot(`"sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"`)
  })

  test('identical content produces identical hashes', () => {
    const hash1 = computeContentHash('identical content')
    const hash2 = computeContentHash('identical content')
    expect(hash1).toMatchInlineSnapshot(`"sha256:15bbe85aac4518db7da507997bd8b9baa07ddea5d0a08d098f85f1bf08c02521"`)
    expect(hash2).toBe(hash1)
  })

  test('different content produces different hashes', () => {
    const hash1 = computeContentHash('content A')
    const hash2 = computeContentHash('content B')
    expect(hash1).toMatchInlineSnapshot(`"sha256:49114a9a2b7d46ec27be62ae3eade12f78d46cf5a99c52cd4f80381d723eed6e"`)
    expect(hash2).toMatchInlineSnapshot(`"sha256:d27a54dc662fff702c2183d536e87414d5fe6fc072f6bc270b01a34f6de265bc"`)
  })

  test('string and Uint8Array of same content produce same hash', () => {
    const content = 'same content'
    const hashStr = computeContentHash(content)
    const hashBytes = computeContentHash(new TextEncoder().encode(content))
    expect(hashStr).toMatchInlineSnapshot(`"sha256:a636bd7cd42060a4d07fa1bfbcc010eb7794c2ba721e1e3e4c20335a15b66eaf"`)
    expect(hashBytes).toBe(hashStr)
  })
})

describe('collectArchiveEntries', () => {
  test('collects manifest and all asset types', () => {
    const resolved: ResolvedFacetManifest = {
      name: 'test',
      version: '1.0.0',
      skills: {
        review: { description: 'Review skill', prompt: '# Review' },
      },
      agents: {
        helper: { description: 'Helper agent', prompt: '# Helper' },
      },
      commands: {
        deploy: { description: 'Deploy command', prompt: '# Deploy' },
      },
    }

    const entries = collectArchiveEntries(resolved, '{"name":"test","version":"1.0.0"}')

    expect(entries).toHaveLength(4)
    expect(entries.map((e) => e.path)).toContain('facet.json')
    expect(entries.map((e) => e.path)).toContain('skills/review/SKILL.md')
    expect(entries.map((e) => e.path)).toContain('agents/helper.md')
    expect(entries.map((e) => e.path)).toContain('commands/deploy.md')
  })

  test('entries are sorted lexicographically by path', () => {
    const resolved: ResolvedFacetManifest = {
      name: 'test',
      version: '1.0.0',
      skills: {
        'z-skill': { description: 'Z', prompt: '# Z' },
        'a-skill': { description: 'A', prompt: '# A' },
      },
      agents: {
        'b-agent': { description: 'B', prompt: '# B' },
      },
    }

    const entries = collectArchiveEntries(resolved, 'manifest content')
    const paths = entries.map((e) => e.path)

    expect(paths).toEqual(['agents/b-agent.md', 'facet.json', 'skills/a-skill/SKILL.md', 'skills/z-skill/SKILL.md'])
  })

  test('handles manifest with no optional asset types', () => {
    const resolved: ResolvedFacetManifest = {
      name: 'minimal',
      version: '0.1.0',
      skills: {
        only: { description: 'Only skill', prompt: '# Only' },
      },
    }

    const entries = collectArchiveEntries(resolved, 'manifest')
    expect(entries).toHaveLength(2)
  })
})

describe('computeAssetHashes', () => {
  test('returns correct hash for each entry', () => {
    const entries = [
      { path: 'facet.json', content: '{"name":"test"}' },
      { path: 'skills/review/SKILL.md', content: '# Review' },
    ]

    const hashes = computeAssetHashes(entries)

    expect(Object.keys(hashes)).toHaveLength(2)
    expect(hashes['facet.json']).toMatchInlineSnapshot(
      `"sha256:7d9fd2051fc32b32feab10946fab6bb91426ab7e39aa5439289ed892864aa91d"`,
    )
    expect(hashes['skills/review/SKILL.md']).toMatchInlineSnapshot(
      `"sha256:f1a9d9d60fba2e67d82d788760d147d95461a58456411e205bf33a6dbdc3497f"`,
    )
  })

  test('hash matches computeContentHash for same content', () => {
    const entries = [{ path: 'test.md', content: 'test content' }]

    const hashes = computeAssetHashes(entries)

    expect(hashes['test.md']).toMatchInlineSnapshot(
      `"sha256:6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72"`,
    )
  })
})

describe('assembleTar', () => {
  test('produces a valid tar archive', () => {
    const entries = [
      { path: 'facet.json', content: '{"name":"test","version":"1.0.0"}' },
      { path: 'skills/review/SKILL.md', content: '# Review skill' },
    ]

    const tar = assembleTar(entries)

    expect(tar).toBeInstanceOf(Uint8Array)
    expect(tar.length).toBeGreaterThan(0)

    const parsed = parseTar(tar)
    expect(parsed).toHaveLength(2)

    const names = parsed.map((f) => f.name)
    expect(names).toContain('facet.json')
    expect(names).toContain('skills/review/SKILL.md')
  })

  test('tar contains correct file contents', () => {
    const entries = [{ path: 'test.md', content: 'hello world' }]

    const tar = assembleTar(entries)
    const parsed = parseTar(tar)

    expect(parsed[0]?.text).toBe('hello world')
  })

  test('produces deterministic output — same input yields identical bytes', () => {
    const entries = [
      { path: 'a.md', content: 'content A' },
      { path: 'b.md', content: 'content B' },
    ]

    const tar1 = assembleTar(entries)
    const tar2 = assembleTar(entries)

    expect(tar1.length).toBe(tar2.length)
    expect(Buffer.from(tar1).equals(Buffer.from(tar2))).toBe(true)
  })

  test('deterministic tar produces stable hash', () => {
    const entries = [
      { path: 'a.md', content: 'content A' },
      { path: 'b.md', content: 'content B' },
    ]

    const tar1 = assembleTar(entries)
    const tar2 = assembleTar(entries)
    const hash1 = computeContentHash(tar1)
    const hash2 = computeContentHash(tar2)

    expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(hash1).toBe(hash2)
  })

  test('tar hash changes when content changes', () => {
    const entries1 = [{ path: 'test.md', content: 'version 1' }]
    const entries2 = [{ path: 'test.md', content: 'version 2' }]

    const tar1 = assembleTar(entries1)
    const tar2 = assembleTar(entries2)

    const hash1 = computeContentHash(tar1)
    const hash2 = computeContentHash(tar2)

    expect(hash1).not.toBe(hash2)
  })
})

describe('compressArchive', () => {
  test('compressed archive can be decompressed to recover original tar', async () => {
    const entries = [
      { path: 'facet.json', content: '{"name":"test","version":"1.0.0"}' },
      { path: 'skills/review/SKILL.md', content: '# Review skill' },
    ]

    const tar = assembleTar(entries)
    const compressed = compressArchive(tar)

    expect(compressed.length).toBeGreaterThan(0)
    expect(compressed.length).toBeLessThan(tar.length) // gzip should compress text content

    // Decompress and verify contents survive the round-trip
    const parsed = await parseTarGzip(compressed)
    expect(parsed).toHaveLength(2)

    const names = parsed.map((f) => f.name)
    expect(names).toContain('facet.json')
    expect(names).toContain('skills/review/SKILL.md')
    expect(parsed.find((f) => f.name === 'skills/review/SKILL.md')?.text).toBe('# Review skill')
  })
})
