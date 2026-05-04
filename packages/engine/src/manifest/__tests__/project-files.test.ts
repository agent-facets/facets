import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upsertFacetInManifest } from '../mutations.ts'
import { loadFacetsJson, writeFacetsJson } from '../project-files.ts'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-pf-'))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('loadFacetsJson', () => {
  test('returns an empty skeleton when facets.json is absent', () => {
    const result = loadFacetsJson(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.existed).toBe(false)
      expect(result.data).toEqual({ facets: {} })
    }
  })

  test('reads and validates an existing facets.json', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{"facets":{"v":"github:a/b#main"}}')
    const result = loadFacetsJson(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.existed).toBe(true)
      expect(result.data.facets.v).toBe('github:a/b#main')
    }
  })

  test('returns an error on malformed JSON', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{not json')
    const result = loadFacetsJson(projectRoot)
    expect(result.ok).toBe(false)
  })

  test('returns an error on shape mismatch', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{"other":{}}')
    const result = loadFacetsJson(projectRoot)
    expect(result.ok).toBe(false)
  })
})

describe('writeFacetsJson', () => {
  test('writes valid JSON with 2-space indentation', () => {
    writeFacetsJson(projectRoot, { facets: { v: 'github:a/b#main' } })
    const raw = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    const reparsed = JSON.parse(raw)
    expect(reparsed).toEqual({ facets: { v: 'github:a/b#main' } })
    expect(raw).toContain('  "facets"')
  })

  test('does not leave the .tmp file around on success', () => {
    writeFacetsJson(projectRoot, { facets: {} })
    expect(existsSync(join(projectRoot, 'facets.json.tmp'))).toBe(false)
  })

  test('round-trips through load + upsert + write preserving comments', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      `{
  // keep me
  "facets": {
    "alpha": "github:a/alpha#main"
  }
}`,
    )
    const loaded = loadFacetsJson(projectRoot)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      upsertFacetInManifest(loaded.data, 'beta', 'github:b/beta#main')
      writeFacetsJson(projectRoot, loaded.data)
    }
    const raw = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    expect(raw).toContain('keep me')
    expect(raw).toContain('beta')
  })
})
