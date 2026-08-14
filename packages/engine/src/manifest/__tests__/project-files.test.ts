import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyDesiredFacets, emptyProjectManifest, type NormalizedFacetEntry } from '../mutations.ts'
import { loadProjectManifest, writeProjectManifest } from '../project-files.ts'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-pf-'))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

const entry = (source: string): NormalizedFacetEntry => ({ source, overrides: undefined })

const read = (): string => readFileSync(join(projectRoot, 'facets.json'), 'utf8')

describe('loadProjectManifest', () => {
  test('returns an empty current-version skeleton when facets.json is absent', () => {
    const result = loadProjectManifest(projectRoot)
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(false)
    expect(result.manifest.facets).toEqual({})
    // A manifest this system creates is never legacy.
    expect(result.manifest.document.manifestVersion).toBe(0.2)
  })

  // The state is a later commit's write precondition, so it has to describe
  // the very bytes that were parsed.
  test('carries the absent state when facets.json does not exist', () => {
    const result = loadProjectManifest(projectRoot)
    if (!result.ok) expect.unreachable()
    if (result.existed) expect.unreachable()
    expect(result.state).toEqual({ kind: 'absent' })
  })

  test('carries the exact bytes it parsed', () => {
    const text = '{"manifestVersion":0.2,"facets":{"a":"1.*"}}\n'
    writeFileSync(join(projectRoot, 'facets.json'), text)

    const result = loadProjectManifest(projectRoot)
    if (!result.ok) expect.unreachable()
    if (!result.existed) expect.unreachable()
    expect(new TextDecoder().decode(result.state.contents)).toBe(text)
  })

  // A decoder that ate the mark would start accepting a document this CLI has
  // always rejected, then rewrite it without the mark.
  test('still rejects a manifest that begins with a byte-order mark', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '\uFEFF{"manifestVersion":0.2,"facets":{}}')

    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid') expect.unreachable()
    expect(result.failure.code).toBe('invalid-json')
  })

  test('reports a path occupied by something other than a plain file as a read failure', () => {
    mkdirSync(join(projectRoot, 'facets.json'))

    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'read') expect.unreachable()
    expect(result.error).toContain('directory')
  })

  test('reads and normalizes a legacy unversioned manifest', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{"facets":{"v":"github:a/b#main"}}')
    const result = loadProjectManifest(projectRoot)
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(result.manifest.loadedVersion).toBe('legacy-unversioned')
    expect(result.manifest.facets.v).toEqual({ source: 'github:a/b#main', overrides: undefined })
  })

  test('reads a current manifest with an expanded entry', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      JSON.stringify({
        manifestVersion: 0.2,
        facets: {
          a: '1.*',
          b: { source: 'github:a/b#main', materialization: { skills: { review: { kind: 'omitted' } } } },
        },
      }),
    )
    const result = loadProjectManifest(projectRoot)
    if (!result.ok) expect.unreachable()
    expect(result.manifest.loadedVersion).toBe(0.2)
    expect(result.manifest.facets.a).toEqual({ source: '1.*', overrides: undefined })
    expect(result.manifest.facets.b?.source).toBe('github:a/b#main')
    expect(result.manifest.facets.b?.overrides?.skills?.review).toEqual({ kind: 'omitted' })
  })

  test('returns a structured failure on malformed JSON', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{not json')
    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid') expect.unreachable()
    expect(result.failure.code).toBe('invalid-json')
  })

  test('returns a structured failure on shape mismatch', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{"other":{}}')
    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('invalid')
  })

  // An unsupported version must reach the caller as data, not prose: the
  // remedy (upgrade the CLI) differs from a malformed document's.
  test('an unsupported manifestVersion carries the observed and supported versions', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{"manifestVersion":0.3,"facets":{}}')
    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid') expect.unreachable()
    if (result.failure.code !== 'unsupported-manifest-version') expect.unreachable()
    expect(result.failure.observed).toBe(0.3)
    expect(result.failure.supported).toEqual([0.1, 0.2])
  })

  // JSON has one number type and no coercion at the dispatch boundary, so
  // the string "0.1" is a different value from the number 0.1. Accepting it
  // would mean shape-sniffing the document, which is what exact dispatch
  // exists to avoid. Protocol pins this; the engine loader must surface it
  // as the same actionable failure rather than a generic parse error.
  test('a string manifestVersion is unsupported, not silently coerced', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{"manifestVersion":"0.1","facets":{}}')
    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid') expect.unreachable()
    if (result.failure.code !== 'unsupported-manifest-version') expect.unreachable()
    expect(result.failure.observed).toBeUndefined()
    expect(result.failure.supported).toEqual([0.1, 0.2])
  })

  test('an expanded entry in an unversioned manifest is rejected, not promoted', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      '{"facets":{"b":{"source":"github:a/b","materialization":{"skills":{"x":{"kind":"omitted"}}}}}}',
    )
    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid') expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.manifestVersion).toBe('legacy-unversioned')
  })

  test('duplicate members are rejected', () => {
    writeFileSync(join(projectRoot, 'facets.json'), '{"facets":{"a":"1.*"},"facets":{"b":"2.*"}}')
    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid') expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  // Comments are a supported input form and must not defeat validation.
  test('a commented manifest still validates and normalizes', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      `{
  // a note
  "facets": {
    // about alpha
    "alpha": "github:a/alpha#main"
  }
}`,
    )
    const result = loadProjectManifest(projectRoot)
    if (!result.ok) expect.unreachable()
    expect(result.manifest.facets.alpha?.source).toBe('github:a/alpha#main')
  })

  // Comment stripping preserves member structure, so a duplicate hidden in a
  // commented document is still caught rather than silently last-wins.
  test('duplicate members are caught even in a commented manifest', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      `{
  // a note
  "facets": { "a": "1.*" },
  "facets": { "b": "2.*" }
}`,
    )
    const result = loadProjectManifest(projectRoot)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid') expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  // A comment must not be mistaken for document structure.
  test('a key mentioned only inside a comment is not a duplicate', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      `{
  "facets": {
    // "alpha": "old-value",
    "alpha": "github:a/alpha#main"
  }
}`,
    )
    const result = loadProjectManifest(projectRoot)
    if (!result.ok) expect.unreachable()
    expect(result.manifest.facets.alpha?.source).toBe('github:a/alpha#main')
  })
})

describe('writeProjectManifest', () => {
  test('writes valid JSON with 2-space indentation', () => {
    const manifest = emptyProjectManifest()
    applyDesiredFacets(manifest.document, { v: entry('github:a/b#main') })
    writeProjectManifest(projectRoot, manifest.document)
    const raw = read()
    expect(JSON.parse(raw)).toEqual({ manifestVersion: 0.2, facets: { v: 'github:a/b#main' } })
    expect(raw).toContain('  "facets"')
  })

  test('does not leave the .tmp file around on success', () => {
    writeProjectManifest(projectRoot, emptyProjectManifest().document)
    expect(existsSync(join(projectRoot, 'facets.json.tmp'))).toBe(false)
  })

  // The regression this guards: the install pipeline used to rebuild the
  // document with object spreads, which silently dropped comment-json's
  // non-enumerable comment symbols.
  test('round-trips through load + apply + write preserving comments', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      `{
  // keep me
  "facets": {
    // about alpha
    "alpha": "github:a/alpha#main"
  }
}`,
    )
    const loaded = loadProjectManifest(projectRoot)
    if (!loaded.ok) expect.unreachable()
    applyDesiredFacets(loaded.manifest.document, {
      alpha: entry('github:a/alpha#main'),
      beta: entry('github:b/beta#main'),
    })
    writeProjectManifest(projectRoot, loaded.manifest.document)

    const raw = read()
    expect(raw).toContain('keep me')
    expect(raw).toContain('about alpha')
    expect(raw).toContain('beta')
  })

  test('a comment on a removed entry disappears with it, siblings survive', () => {
    writeFileSync(
      join(projectRoot, 'facets.json'),
      `{
  "facets": {
    // about alpha
    "alpha": "github:a/alpha#main",
    // about beta
    "beta": "github:b/beta#main"
  }
}`,
    )
    const loaded = loadProjectManifest(projectRoot)
    if (!loaded.ok) expect.unreachable()
    applyDesiredFacets(loaded.manifest.document, { alpha: entry('github:a/alpha#main') })
    writeProjectManifest(projectRoot, loaded.manifest.document)

    const raw = read()
    expect(raw).toContain('about alpha')
    expect(raw).not.toContain('"beta"')
  })
})
