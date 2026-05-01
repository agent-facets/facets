import { describe, expect, test } from 'bun:test'
import { parseFacetSource as parseSource } from '../parse-source.ts'

describe('parseSource — registry forms', () => {
  test('bare name resolves to latest', () => {
    const result = parseSource('viper-plans')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'registry',
        name: 'viper-plans',
        version: { kind: 'latest' },
      })
    }
  })

  test('name@latest resolves to latest', () => {
    const result = parseSource('viper-plans@latest')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'registry',
        name: 'viper-plans',
        version: { kind: 'latest' },
      })
    }
  })

  test('name@* resolves to wildcard', () => {
    const result = parseSource('viper-plans@*')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'registry',
        name: 'viper-plans',
        version: { kind: 'wildcard' },
      })
    }
  })

  test('name@exact pins to exact version', () => {
    const result = parseSource('viper-plans@1.2.3')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'registry',
        name: 'viper-plans',
        version: { kind: 'exact', major: 1, minor: 2, patch: 3 },
      })
    }
  })

  test('name@major.* pins to major', () => {
    const result = parseSource('viper-plans@1.*')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'registry',
        name: 'viper-plans',
        version: { kind: 'majorWildcard', major: 1 },
      })
    }
  })

  test('name@major.minor.* pins to minor', () => {
    const result = parseSource('viper-plans@1.2.*')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'registry',
        name: 'viper-plans',
        version: { kind: 'minorWildcard', major: 1, minor: 2 },
      })
    }
  })

  test('latest equivalence: bare, @latest, and @* are semantically identical', () => {
    const bareResult = parseSource('viper-plans')
    const latestResult = parseSource('viper-plans@latest')
    const wildcardResult = parseSource('viper-plans@*')
    expect(bareResult.ok && latestResult.ok && wildcardResult.ok).toBe(true)
    if (!bareResult.ok || !latestResult.ok || !wildcardResult.ok) return
    // All three are registry sources for the same name. The version surface
    // form is preserved (bare and latest both produce kind:'latest', * produces
    // kind:'wildcard') but resolvesToLatest collapses all three to the same
    // resolution branch.
    expect(bareResult.value.kind).toBe('registry')
    expect(latestResult.value.kind).toBe('registry')
    expect(wildcardResult.value.kind).toBe('registry')
  })

  test('invalid version inside name@ tail propagates error', () => {
    const result = parseSource('viper-plans@^1.0.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CARET_RANGE')
  })
})

describe('parseSource — git forms', () => {
  test('github shorthand without ref', () => {
    const result = parseSource('github:owner/repo')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'git',
        url: 'https://github.com/owner/repo.git',
      })
    }
  })

  test('github shorthand with ref', () => {
    const result = parseSource('github:owner/repo#main')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'git',
        url: 'https://github.com/owner/repo.git',
        ref: 'main',
      })
    }
  })

  test('github shorthand with .git suffix is normalized', () => {
    const result = parseSource('github:owner/repo.git')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ url: 'https://github.com/owner/repo.git' })
  })

  test('https URL ending in .git', () => {
    const result = parseSource('https://github.com/owner/repo.git')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'git',
        url: 'https://github.com/owner/repo.git',
      })
    }
  })

  test('https URL with ref', () => {
    const result = parseSource('https://github.com/owner/repo.git#v1.0.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'git',
        url: 'https://github.com/owner/repo.git',
        ref: 'v1.0.0',
      })
    }
  })

  test('ssh URL', () => {
    const result = parseSource('ssh://git@github.com/owner/repo.git#main')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.kind).toBe('git')
  })

  test('SCP-style git URL', () => {
    const result = parseSource('git@github.com:owner/repo.git')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'git',
        url: 'git@github.com:owner/repo.git',
      })
    }
  })

  test('SCP-style git URL with ref', () => {
    const result = parseSource('git@github.com:owner/repo.git#main')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'git',
        url: 'git@github.com:owner/repo.git',
        ref: 'main',
      })
    }
  })
})

describe('parseSource — local forms', () => {
  test('relative path with ./', () => {
    const result = parseSource('./local/facet')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: './local/facet' })
  })

  test('relative path with ../', () => {
    const result = parseSource('../sibling/facet')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: '../sibling/facet' })
  })

  test('absolute path with leading slash', () => {
    const result = parseSource('/abs/path/to/facet')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: '/abs/path/to/facet' })
  })

  test('home-relative path', () => {
    const result = parseSource('~/facets/my-facet')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: '~/facets/my-facet' })
  })

  test('Windows drive-letter path', () => {
    const result = parseSource('C:/facets/my-facet')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: 'C:/facets/my-facet' })
  })

  test('file: prefix is stripped (relative)', () => {
    const result = parseSource('file:./local/facet')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: './local/facet' })
  })

  test('file: prefix is stripped (absolute)', () => {
    const result = parseSource('file:/abs/path')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: '/abs/path' })
  })

  test('bare dot is a local path', () => {
    const result = parseSource('.')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'local', path: '.' })
  })
})

describe('parseSource — rejected forms', () => {
  test('empty string', () => {
    const result = parseSource('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EMPTY')
  })

  test.each([
    'git+https://x/y.git',
    'git+ssh://git@x:y/z.git',
    'git+file:///tmp/repo',
  ])('git+ prefix is rejected (%p)', (input) => {
    const result = parseSource(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('GIT_PLUS_PREFIX')
  })

  test('empty file: specifier', () => {
    const result = parseSource('file:')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EMPTY')
  })

  test('unknown URL scheme is rejected', () => {
    const result = parseSource('ftp://example.com/repo.git')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_SCHEME')
  })

  test('https URL without .git is rejected', () => {
    const result = parseSource('https://example.com/something')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_SCHEME')
  })

  test('caret range in name@ tail is rejected', () => {
    const result = parseSource('viper-plans@^1.0.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CARET_RANGE')
  })

  test('tilde range in name@ tail is rejected', () => {
    const result = parseSource('viper-plans@~1.0.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TILDE_RANGE')
  })

  test('completely unrecognized specifier', () => {
    const result = parseSource('!!@@##')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_REGISTRY_NAME')
  })
})
