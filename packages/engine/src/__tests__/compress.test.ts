import { describe, expect, test } from 'bun:test'
import { assembleTar } from '@agent-facets/protocol'
import { parseTarGzip } from 'nanotar'
import { compressArchive } from '../build/compress.ts'

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
