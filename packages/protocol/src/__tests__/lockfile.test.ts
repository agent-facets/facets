import { describe, expect, test } from 'bun:test'
import { LOCKFILE_VERSION_0_2, type Lockfile02, Lockfile02Schema } from '@agent-facets/protocol'
import { type } from 'arktype'

// Rules exercised here — source provenance, asset-name safety, locked-version
// grammar, unknown-field tolerance — live on schema nodes SHARED by every
// lockfile version. `0.2` is the vehicle because it is the narrowest
// SUPPORTED schema that contains all of them: it adds no materialization
// disposition, so a failure here is unambiguously a shared-rule failure.
// Version-specific behavior is covered in `lockfile-versions.test.ts`.

const HASH = `sha256:${'a'.repeat(64)}`

/** Canonical single-file records, so ownership rules are never the variable. */
const skillFiles = (name: string) => [{ path: `skills/${name}/SKILL.md`, integrity: HASH }]
const agentFiles = (name: string) => [{ path: `agents/${name}.md`, integrity: HASH }]
const commandFiles = (name: string) => [{ path: `commands/${name}.md`, integrity: HASH }]

// --- Valid lockfiles ---

describe('Lockfile02Schema — valid lockfiles', () => {
  test('git-source facet with assets', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'viper-plans': {
          source: {
            kind: 'git',
            url: 'github:agent-facets/viper-plans',
            commit: 'abc123def0123456789abc123def0123456789abc',
          },
          version: '0.1.0',
          integrity: 'sha256:abcdef',
          assets: [
            { scope: 'user', type: 'skill', name: 'planning', files: skillFiles('planning') },
            { scope: 'user', type: 'command', name: 'plan', files: commandFiles('plan') },
          ],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile02
    expect(data.facets['viper-plans']?.version).toBe('0.1.0')
    expect(data.facets['viper-plans']?.assets).toHaveLength(2)
    expect(data.facets['viper-plans']?.assets[0]).toEqual({
      scope: 'user',
      type: 'skill',
      name: 'planning',
      files: skillFiles('planning'),
    })
  })

  test('local-source facet records a path', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'local-plans': {
          source: { kind: 'local', path: 'file:./facets/local-plans' },
          version: '0.0.1',
          integrity: 'sha256:xyz',
          assets: [{ scope: 'project', type: 'agent', name: 'reviewer', files: agentFiles('reviewer') }],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile02
    const source = data.facets['local-plans']?.source
    if (source?.kind !== 'local') expect.unreachable()
    expect(source.path).toBe('file:./facets/local-plans')
  })

  test('registry-source facet records the registry origin and no version specifier', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
          version: '0.1.1',
          integrity: 'sha256:reg',
          assets: [{ scope: 'user', type: 'skill', name: 'planning', files: skillFiles('planning') }],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile02
    const source = data.facets.cowsay?.source
    if (source?.kind !== 'registry') expect.unreachable()
    expect(source.registry).toBe('https://api.agentfacets.io')
  })

  test('lockfile with zero facets is valid', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {},
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile02
    expect(Object.keys(data.facets)).toHaveLength(0)
  })

  test('facet with zero assets is valid', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'empty-facet': {
          source: {
            kind: 'git',
            url: 'github:agent-facets/empty-facet',
            commit: 'aaa111aaa111aaa111aaa111aaa111aaa111aaa1',
          },
          version: '1.0.0',
          integrity: 'sha256:empty',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('all asset scopes and types are accepted', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'mixed-facet': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '1.0.0',
          integrity: 'sha256:mix',
          assets: [
            { scope: 'system', type: 'skill', name: 's1', files: skillFiles('s1') },
            { scope: 'user', type: 'agent', name: 'a1', files: agentFiles('a1') },
            { scope: 'project', type: 'command', name: 'c1', files: commandFiles('c1') },
          ],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })
})

// --- Invalid lockfiles ---

describe('Lockfile02Schema — invalid lockfiles', () => {
  test('missing lockfileVersion is rejected', () => {
    const input = {
      facets: {},
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('missing integrity on facet entry is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('unknown asset scope is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [{ scope: 'global', type: 'skill', name: 'x', files: skillFiles('x') }],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('unknown asset type is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [{ scope: 'user', type: 'hook', name: 'x', files: skillFiles('x') }],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('missing assets array is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  // Path-traversal gate symmetric with FacetManifestSchema: a crafted
  // facets.lock must not be able to smuggle `..`, empty segments, or
  // backslashes into the asset name — those feed adapter I/O paths during
  // install-time deletion.
  test.each(['../escape', 'a/../b', './dotdir', 'a//b', '..\\escape', 'a\\b'])('asset name %p is rejected', (name) => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        pwn: {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [{ scope: 'user', type: 'skill', name, files: skillFiles('safe') }],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  // Lockfile-version narrowing: anything that is not exact `M.N.P` must
  // fail validation up front so the install pipeline never sees a
  // version string its `parseLockedVersion` can't handle. Prerelease
  // strings are intentionally rejected — `VersionSpec` doesn't model
  // prereleases yet; widening the parser would require widening this
  // schema in lockstep.
  test.each([
    '',
    'foo',
    '1.2',
    '1.2.3.4',
    'a.b.c',
    '1.2.3-beta.1',
    'v1.2.3',
    '1.2.3 ',
    ' 1.2.3',
    // Conforming shape, unrepresentable magnitude: past 2^53 - 1 this
    // version and the next one are the same double, so accepting it
    // would let the installer confuse two distinct releases.
    '9007199254740992.0.0',
    '1.9007199254740992.0',
    '1.0.9007199254740992',
  ])('version %p is rejected', (version) => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'bad-version': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version,
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  // The bound is inclusive: the largest exactly-representable component
  // is a legal version, so the rejection above is about magnitude rather
  // than about long version numbers in general.
  test('version at the representable bound is accepted', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'huge-version': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '9007199254740991.0.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })

  // A git source's commit is a REQUIRED field — a git entry without one
  // is not reproducible, so it must fail validation. (Extra/unknown keys
  // on a source remain tolerated by design for forward-compat; only
  // missing-or-malformed required fields are rejected.)
  test('git source without a commit is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  // A git source's commit must be a lowercase hex SHA of at least 8 chars.
  // An empty, too-short, or non-hex commit is effectively "unresolved" and
  // would let a later clone fall back to a branch/default instead of pinning
  // a reproducible identity — so it must fail validation up front.
  test.each([
    '',
    'abc',
    '1234567',
    'ABCDEF0123456789',
    'g'.repeat(40),
    'abc123 ',
    'sha256:abc',
  ])('git commit %p is rejected', (commit) => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'bad-commit': {
          source: { kind: 'git', url: 'github:a/b', commit },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  // Accepted: a full SHA-1 (40 chars), a SHA-256 (64 chars), and an
  // abbreviated-but-≥8 hex commit. The narrow has no upper bound so future
  // hash formats don't need a special case.
  test.each([
    'a'.repeat(40),
    'a'.repeat(64),
    'abc12345',
    'abc123def0123456789abc123def0123456789abc',
  ])('git commit %p is accepted', (commit) => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'good-commit': {
          source: { kind: 'git', url: 'github:a/b', commit },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('source with an unrecognized kind is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        'viper-plans': {
          source: { kind: 'ftp', url: 'ftp://x/y' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).toBeInstanceOf(type.errors)
  })
})

// --- Unknown field pass-through ---

describe('Lockfile02Schema — unknown field tolerance', () => {
  test('unknown top-level field is preserved', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {},
      generatedAt: '2026-04-18',
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile02 & { generatedAt: string }
    expect(data.generatedAt).toBe('2026-04-18')
  })

  // Forward-compat at the SOURCE level: a newer producer may add fields to
  // a source variant that an older consumer doesn't recognize. The older
  // consumer MUST still accept the lockfile — only a missing or malformed
  // REQUIRED field fails. (This nested tolerance is arktype's default; the
  // test pins it so it can't silently regress to strict rejection.)
  test('a source carrying extra unrecognized keys is accepted', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.agentfacets.io', futureField: 'whatever' },
          version: '0.1.1',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile02
    const source = data.facets.cowsay?.source
    if (source?.kind !== 'registry') expect.unreachable()
    expect(source.registry).toBe('https://api.agentfacets.io')
  })

  // Nested tolerance at the ASSET and FILE-RECORD levels too, pinned for the
  // same reason: `preserveLockfileExtensions` can only carry forward what the
  // schema admits in the first place.
  test('unknown keys on a facet entry, asset, and file record are preserved', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
          version: '0.1.1',
          integrity: 'sha256:x',
          facetNote: 'facet-level',
          assets: [
            {
              scope: 'user',
              type: 'skill',
              name: 'planning',
              assetNote: 'asset-level',
              files: [{ path: 'skills/planning/SKILL.md', integrity: HASH, fileNote: 'file-level' }],
            },
          ],
        },
      },
    }
    const result = Lockfile02Schema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const entry = (result as Lockfile02).facets.cowsay as unknown as {
      facetNote: string
      assets: Array<{ assetNote: string; files: Array<{ fileNote: string }> }>
    }
    expect(entry.facetNote).toBe('facet-level')
    expect(entry.assets[0]?.assetNote).toBe('asset-level')
    expect(entry.assets[0]?.files[0]?.fileNote).toBe('file-level')
  })
})
