import { describe, expect, test } from 'bun:test'
import type { CurrentLockfile, Lockfile02, Lockfile03 } from '@agent-facets/protocol'
import {
  CURRENT_LOCKFILE_VERSION,
  LOCKFILE_VERSION_0_2,
  LOCKFILE_VERSION_0_3,
  preserveLockfileExtensions,
} from '@agent-facets/protocol'

/**
 * The published contract says unrecognized lockfile fields are preserved.
 * Loading always honored it; rewriting did not, because a producer rebuilds
 * entries from resolved state. These tests pin the rewrite half — including
 * across the mandatory `0.2 → 0.3` migration, which is the case that
 * silently discarded extension data on every install.
 */

const HASH = `sha256:${'c'.repeat(64)}`

const skillFiles = [{ path: 'skills/review/SKILL.md', integrity: HASH }]

/** A `0.3` document carrying only canonical fields — what a producer builds. */
function next(overrides: Partial<CurrentLockfile> = {}): CurrentLockfile {
  return {
    lockfileVersion: LOCKFILE_VERSION_0_3,
    facets: {
      cowsay: {
        source: { kind: 'registry', registry: 'https://cafe.example' },
        version: '1.0.0',
        integrity: HASH,
        assets: [
          {
            scope: 'project',
            type: 'skill',
            name: 'review',
            materialization: { kind: 'authored' },
            files: skillFiles,
          },
        ],
      },
    },
    ...overrides,
  } as CurrentLockfile
}

/** The same document as it was loaded, with an extension at every level. */
function previousWithExtensions(version: number): Lockfile02 | Lockfile03 {
  const asset: Record<string, unknown> = {
    scope: 'project',
    type: 'skill',
    name: 'review',
    assetNote: 'asset-level',
    files: [{ path: 'skills/review/SKILL.md', integrity: HASH, fileNote: 'file-level' }],
  }
  if (version === LOCKFILE_VERSION_0_3) asset.materialization = { kind: 'authored' }
  return {
    lockfileVersion: version,
    documentNote: 'document-level',
    facets: {
      cowsay: {
        source: { kind: 'registry', registry: 'https://cafe.example', sourceNote: 'source-level' },
        version: '1.0.0',
        integrity: HASH,
        facetNote: 'facet-level',
        assets: [asset],
      },
    },
  } as unknown as Lockfile02 | Lockfile03
}

/** Read an arbitrary key without pretending the schema declares it. */
function extension(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key]
}

describe('preserveLockfileExtensions', () => {
  test.each([
    LOCKFILE_VERSION_0_2,
    LOCKFILE_VERSION_0_3,
  ])('carries extensions at every level through a rewrite (from %p)', (version) => {
    const merged = preserveLockfileExtensions(previousWithExtensions(version), next())

    expect(extension(merged, 'documentNote')).toBe('document-level')
    const facet = merged.facets.cowsay
    if (facet === undefined) expect.unreachable()
    expect(extension(facet, 'facetNote')).toBe('facet-level')
    expect(extension(facet.source, 'sourceNote')).toBe('source-level')
    const asset = facet.assets[0]
    if (asset === undefined) expect.unreachable()
    expect(extension(asset, 'assetNote')).toBe('asset-level')
    const file = asset.files[0]
    if (file === undefined) expect.unreachable()
    expect(extension(file, 'fileNote')).toBe('file-level')
  })

  test('the new document keeps every canonical value', () => {
    const merged = preserveLockfileExtensions(previousWithExtensions(LOCKFILE_VERSION_0_2), next())

    expect(merged.lockfileVersion).toBe(LOCKFILE_VERSION_0_3)
    expect(merged.facets.cowsay?.assets[0]?.materialization).toEqual({ kind: 'authored' })
    // The record keeps its canonical fields; the extension rides alongside
    // rather than replacing them.
    expect(merged.facets.cowsay?.assets[0]?.files).toHaveLength(1)
    expect(merged.facets.cowsay?.assets[0]?.files[0]?.path).toBe('skills/review/SKILL.md')
    expect(merged.facets.cowsay?.assets[0]?.files[0]?.integrity).toBe(HASH)
  })

  // The whole point of copying only ABSENT keys: a future schema version can
  // claim a name an older document used as an extension, and the new meaning
  // must win rather than being shadowed by stale data.
  test('a schema-defined field wins a name collision', () => {
    const previous = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://old.example' },
          version: '0.9.0',
          integrity: `sha256:${'d'.repeat(64)}`,
          assets: [{ scope: 'project', type: 'skill', name: 'review', files: skillFiles }],
        },
      },
    } as unknown as Lockfile02

    const merged = preserveLockfileExtensions(previous, next())

    expect(merged.facets.cowsay?.version).toBe('1.0.0')
    expect(merged.facets.cowsay?.integrity).toBe(HASH)
    if (merged.facets.cowsay?.source.kind !== 'registry') expect.unreachable()
    expect(merged.facets.cowsay.source.registry).toBe('https://cafe.example')
  })

  test('extensions of a removed facet are dropped with it', () => {
    const previous = {
      ...previousWithExtensions(LOCKFILE_VERSION_0_2),
      facets: {
        ...previousWithExtensions(LOCKFILE_VERSION_0_2).facets,
        gone: {
          source: { kind: 'local', path: '../gone' },
          version: '1.0.0',
          integrity: HASH,
          goneNote: 'should not survive',
          assets: [],
        },
      },
    } as unknown as Lockfile02

    const merged = preserveLockfileExtensions(previous, next())

    expect(merged.facets.gone).toBeUndefined()
    expect(JSON.stringify(merged)).not.toContain('should not survive')
  })

  test('extensions of a removed asset and file record are dropped with them', () => {
    const previous = previousWithExtensions(LOCKFILE_VERSION_0_2) as unknown as {
      facets: Record<string, { assets: Array<Record<string, unknown>> }>
    }
    previous.facets.cowsay?.assets.push({
      scope: 'project',
      type: 'command',
      name: 'deploy',
      staleAssetNote: 'should not survive',
      files: [{ path: 'commands/deploy.md', integrity: HASH }],
    })
    const firstAsset = previous.facets.cowsay?.assets[0] as { files: Array<Record<string, unknown>> }
    firstAsset.files.push({ path: 'skills/review/notes.md', integrity: HASH, staleFileNote: 'should not survive' })

    const merged = preserveLockfileExtensions(previous as unknown as Lockfile02, next())

    expect(merged.facets.cowsay?.assets).toHaveLength(1)
    expect(merged.facets.cowsay?.assets[0]?.files).toHaveLength(1)
    expect(JSON.stringify(merged)).not.toContain('should not survive')
  })

  // A facet that changed provenance has a genuinely different source value.
  // Carrying the old kind's extras into it would describe an origin that no
  // longer exists.
  test('source extensions are dropped when the source kind changes', () => {
    const previous = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
          source: { kind: 'git', url: 'github:a/b', commit: 'a'.repeat(40), gitNote: 'should not survive' },
          version: '1.0.0',
          integrity: HASH,
          assets: [{ scope: 'project', type: 'skill', name: 'review', files: skillFiles }],
        },
      },
    } as unknown as Lockfile02

    const merged = preserveLockfileExtensions(previous, next())

    expect(merged.facets.cowsay?.source).toEqual({ kind: 'registry', registry: 'https://cafe.example' })
    expect(JSON.stringify(merged)).not.toContain('should not survive')
  })

  test('a facet absent from the previous document is passed through untouched', () => {
    const merged = preserveLockfileExtensions({ lockfileVersion: LOCKFILE_VERSION_0_2, facets: {} }, next())
    expect(merged).toEqual(next())
  })

  test('neither argument is mutated', () => {
    const previous = previousWithExtensions(LOCKFILE_VERSION_0_2)
    const snapshot = structuredClone(previous)
    const built = next()
    const builtSnapshot = structuredClone(built)

    preserveLockfileExtensions(previous, built)

    expect(previous).toEqual(snapshot)
    expect(built).toEqual(builtSnapshot)
  })

  // Facet names are unconstrained strings, so an indexed read of
  // `constructor` would return an inherited function instead of `undefined`.
  test('a facet named constructor does not resolve to an inherited value', () => {
    const entry = {
      source: { kind: 'local' as const, path: '../ctor' },
      version: '1.0.0',
      integrity: HASH,
      assets: [],
    }
    // Held in a variable rather than written as a literal key: reading
    // `merged.facets.constructor` resolves to `Object.prototype.constructor`
    // at the type level too, and the formatter rewrites a literal bracket
    // access back into that dotted form.
    const facetName = 'constructor'
    const built = next({ facets: { [facetName]: entry } })

    const merged = preserveLockfileExtensions({ lockfileVersion: LOCKFILE_VERSION_0_2, facets: {} }, built)

    expect(merged.facets[facetName]).toEqual(entry)
    expect(Object.keys(merged.facets)).toEqual([facetName])
  })

  // An extension key spelled `__proto__` must land as an own property rather
  // than invoking the prototype setter and disappearing.
  test('an extension named __proto__ survives as an own key', () => {
    const previous = JSON.parse(
      JSON.stringify({ lockfileVersion: LOCKFILE_VERSION_0_2, facets: {} }).replace(
        '"facets":{}',
        '"facets":{},"__proto__":{"note":"own"}',
      ),
    ) as Lockfile02

    const merged = preserveLockfileExtensions(previous, next())

    expect(Object.hasOwn(merged, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
  })

  // The same hazard on the facet map, where the consequence is worse: the
  // function whose entire job is preservation would drop the facet it was
  // handed, because assignment for this key creates no own member.
  test('a facet named __proto__ survives as an own key', () => {
    const raw = JSON.stringify({
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: {
        PLACEHOLDER: { source: { kind: 'local', path: '../p' }, version: '1.0.0', integrity: HASH, assets: [] },
      },
    }).replace('"PLACEHOLDER"', '"__proto__"')
    // Parsed, never written as a literal: `{ __proto__: … }` in source sets
    // the prototype instead of creating the member under test.
    const built = JSON.parse(raw) as CurrentLockfile

    const merged = preserveLockfileExtensions({ lockfileVersion: LOCKFILE_VERSION_0_2, facets: {} }, built)

    expect(Object.hasOwn(merged.facets, '__proto__')).toBe(true)
    expect(Object.keys(merged.facets)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(merged.facets)).toBe(Object.prototype)
  })
})
