import { describe, expect, test } from 'bun:test'
import { LOCKFILE_VERSION, type Lockfile, LockfileSchema } from '@agent-facets/protocol'
import { type } from 'arktype'

// --- Valid lockfiles ---

describe('LockfileSchema — valid lockfiles', () => {
  test('git-source facet with assets', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
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
            { scope: 'user', type: 'skill', name: 'planning' },
            { scope: 'user', type: 'command', name: 'plan' },
          ],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile
    expect(data.facets['viper-plans']?.version).toBe('0.1.0')
    expect(data.facets['viper-plans']?.assets).toHaveLength(2)
    expect(data.facets['viper-plans']?.assets[0]).toEqual({
      scope: 'user',
      type: 'skill',
      name: 'planning',
    })
  })

  test('local-source facet records a path', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'local-plans': {
          source: { kind: 'local', path: 'file:./facets/local-plans' },
          version: '0.0.1',
          integrity: 'sha256:xyz',
          assets: [{ scope: 'project', type: 'agent', name: 'reviewer' }],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile
    const source = data.facets['local-plans']?.source
    if (source?.kind !== 'local') expect.unreachable()
    expect(source.path).toBe('file:./facets/local-plans')
  })

  test('registry-source facet records the registry origin and no version specifier', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.facet.cafe' },
          version: '0.1.1',
          integrity: 'sha256:reg',
          assets: [{ scope: 'user', type: 'skill', name: 'planning' }],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile
    const source = data.facets.cowsay?.source
    if (source?.kind !== 'registry') expect.unreachable()
    expect(source.registry).toBe('https://api.facet.cafe')
  })

  test('lockfile with zero facets is valid', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {},
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile
    expect(Object.keys(data.facets)).toHaveLength(0)
  })

  test('facet with zero assets is valid', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
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
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('all asset scopes and types are accepted', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'mixed-facet': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '1.0.0',
          integrity: 'sha256:mix',
          assets: [
            { scope: 'system', type: 'skill', name: 's1' },
            { scope: 'user', type: 'agent', name: 'a1' },
            { scope: 'project', type: 'command', name: 'c1' },
          ],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })
})

// --- Invalid lockfiles ---

describe('LockfileSchema — invalid lockfiles', () => {
  test('missing lockfileVersion is rejected', () => {
    const input = {
      facets: {},
    }
    const result = LockfileSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('missing integrity on facet entry is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          assets: [],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('unknown asset scope is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [{ scope: 'global', type: 'skill', name: 'x' }],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('unknown asset type is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [{ scope: 'user', type: 'hook', name: 'x' }],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('missing assets array is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  // Path-traversal gate symmetric with FacetManifestSchema: a crafted
  // facets.lock must not be able to smuggle `..`, empty segments, or
  // backslashes into the asset name — those feed adapter I/O paths during
  // install-time deletion.
  test.each(['../escape', 'a/../b', './dotdir', 'a//b', '..\\escape', 'a\\b'])('asset name %p is rejected', (name) => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        pwn: {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [{ scope: 'user', type: 'skill', name }],
        },
      },
    }
    const result = LockfileSchema(input)
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
  ])('version %p is rejected', (version) => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'bad-version': {
          source: { kind: 'git', url: 'github:a/b', commit: 'abcabcabcabcabcabcabcabcabcabcabcabcabca' },
          version,
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  // A git source's commit is a REQUIRED field — a git entry without one
  // is not reproducible, so it must fail validation. (Extra/unknown keys
  // on a source remain tolerated by design for forward-compat; only
  // missing-or-malformed required fields are rejected.)
  test('git source without a commit is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: { kind: 'git', url: 'github:a/b' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = LockfileSchema(input)
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
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'bad-commit': {
          source: { kind: 'git', url: 'github:a/b', commit },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = LockfileSchema(input)
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
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'good-commit': {
          source: { kind: 'git', url: 'github:a/b', commit },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('source with an unrecognized kind is rejected', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: { kind: 'ftp', url: 'ftp://x/y' },
          version: '0.1.0',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })
})

// --- Unknown field pass-through ---

describe('LockfileSchema — unknown field tolerance', () => {
  test('unknown top-level field is preserved', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {},
      generatedAt: '2026-04-18',
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile & { generatedAt: string }
    expect(data.generatedAt).toBe('2026-04-18')
  })

  // Forward-compat at the SOURCE level: a newer producer may add fields to
  // a source variant that an older consumer doesn't recognize. The older
  // consumer MUST still accept the lockfile — only a missing or malformed
  // REQUIRED field fails. (This nested tolerance is arktype's default; the
  // test pins it so it can't silently regress to strict rejection.)
  test('a source carrying extra unrecognized keys is accepted', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.facet.cafe', futureField: 'whatever' },
          version: '0.1.1',
          integrity: 'sha256:x',
          assets: [],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile
    const source = data.facets.cowsay?.source
    if (source?.kind !== 'registry') expect.unreachable()
    expect(source.registry).toBe('https://api.facet.cafe')
  })
})
