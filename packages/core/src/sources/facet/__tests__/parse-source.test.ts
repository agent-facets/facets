import { describe, expect, test } from 'bun:test'
import { parseFacetSource } from '../parse-source.ts'

describe('parseFacetSource — github shortcut', () => {
  test('expands to https git URL with .git suffix', () => {
    const result = parseFacetSource('github:agent-facets/viper-plans')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        type: 'git',
        url: 'https://github.com/agent-facets/viper-plans.git',
      })
    }
  })

  test('captures ref after #', () => {
    const result = parseFacetSource('github:agent-facets/viper-plans#main')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        type: 'git',
        url: 'https://github.com/agent-facets/viper-plans.git',
        commitish: 'main',
      })
    }
  })

  test('ref can be a full SHA', () => {
    const result = parseFacetSource('github:agent-facets/viper-plans#abc123def0123456789abc123def0123456789ab')
    expect(result.ok).toBe(true)
    if (result.ok && result.data.type === 'git') {
      expect(result.data.commitish).toBe('abc123def0123456789abc123def0123456789ab')
    }
  })
})

describe('parseFacetSource — git+ URLs', () => {
  test('git+https strips the prefix', () => {
    const result = parseFacetSource('git+https://github.com/agent-facets/viper-plans.git#main')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        type: 'git',
        url: 'https://github.com/agent-facets/viper-plans.git',
        commitish: 'main',
      })
    }
  })

  test('git+ssh strips the prefix', () => {
    const result = parseFacetSource('git+ssh://git@github.com/agent-facets/viper-plans.git#v0.1.0')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        type: 'git',
        url: 'ssh://git@github.com/agent-facets/viper-plans.git',
        commitish: 'v0.1.0',
      })
    }
  })

  test('git+https without ref', () => {
    const result = parseFacetSource('git+https://example.com/facet.git')
    expect(result.ok).toBe(true)
    if (result.ok && result.data.type === 'git') {
      expect(result.data.url).toBe('https://example.com/facet.git')
      expect(result.data.commitish).toBeUndefined()
    }
  })
})

describe('parseFacetSource — bare https git URL', () => {
  test('treated as git when URL contains .git', () => {
    const result = parseFacetSource('https://github.com/agent-facets/viper-plans.git#main')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        type: 'git',
        url: 'https://github.com/agent-facets/viper-plans.git',
        commitish: 'main',
      })
    }
  })
})

describe('parseFacetSource — local paths', () => {
  test('file:./relative → local path', () => {
    const result = parseFacetSource('file:./facets/viper-plans')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ type: 'local', path: './facets/viper-plans' })
    }
  })

  test('file:../parent → local path', () => {
    const result = parseFacetSource('file:../parent/facet')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ type: 'local', path: '../parent/facet' })
    }
  })

  test('file:/abs → local absolute path', () => {
    const result = parseFacetSource('file:/tmp/some-facet')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ type: 'local', path: '/tmp/some-facet' })
    }
  })
})

describe('parseFacetSource — rejections', () => {
  test('empty string', () => {
    const result = parseFacetSource('')
    expect(result.ok).toBe(false)
  })

  test('bare registry name rejected with roadmap message', () => {
    const result = parseFacetSource('viper-plans')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('registry')
      expect(result.error).toContain('closed alpha')
    }
  })

  test('unknown scheme rejected', () => {
    const result = parseFacetSource('ftp://example.com/facet')
    expect(result.ok).toBe(false)
  })

  // F15 — git URL with a leading `-` would be reinterpreted as a flag by
  // `git clone`. Reject at parse time with a scheme-allowlist check.
  test.each([
    'git+-c core.sshCommand=evil',
    'git+--upload-pack=/bin/sh',
    'git+-oProxyCommand=evil',
  ])('git+ with leading `-` is rejected (%p)', (specifier) => {
    const result = parseFacetSource(specifier)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('must start with')
  })

  test('git+ with empty URL is rejected', () => {
    const result = parseFacetSource('git+')
    expect(result.ok).toBe(false)
  })

  test('git+ with non-allowlisted scheme is rejected', () => {
    const result = parseFacetSource('git+javascript://evil')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('must start with')
  })
})
