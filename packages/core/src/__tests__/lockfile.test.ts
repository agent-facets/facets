import { describe, expect, test } from 'bun:test'
import { type } from 'arktype'
import { LOCKFILE_VERSION, type Lockfile, LockfileSchema } from '../schemas/lockfile.ts'

// --- Valid lockfiles ---

describe('LockfileSchema — valid lockfiles', () => {
  test('git-source facet with assets', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: 'github:agent-facets/viper-plans',
          ref: 'main',
          commit: 'abc123def0123456789abc123def0123456789abc',
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

  test('local-source facet omits ref and commit', () => {
    const input = {
      lockfileVersion: LOCKFILE_VERSION,
      facets: {
        'local-plans': {
          source: 'file:./facets/local-plans',
          version: '0.0.1',
          integrity: 'sha256:xyz',
          assets: [{ scope: 'project', type: 'agent', name: 'reviewer' }],
        },
      },
    }
    const result = LockfileSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Lockfile
    expect(data.facets['local-plans']?.ref).toBeUndefined()
    expect(data.facets['local-plans']?.commit).toBeUndefined()
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
          source: 'github:agent-facets/empty-facet',
          ref: 'main',
          commit: 'aaa111',
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
          source: 'github:a/b',
          ref: 'main',
          commit: 'abc',
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
          source: 'github:a/b',
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
          source: 'github:a/b',
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
          source: 'github:a/b',
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
          source: 'github:a/b',
          version: '0.1.0',
          integrity: 'sha256:x',
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
})
