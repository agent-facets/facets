import { describe, expect, test } from 'bun:test'
import { parseSource } from '../parse-source.ts'

describe('parseSource — github shortcut', () => {
  test('expands to https git URL with .git suffix', () => {
    const result = parseSource('github:agent-facets/viper-plans')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        type: 'git',
        url: 'https://github.com/agent-facets/viper-plans.git',
      })
    }
  })

  test('captures ref after #', () => {
    const result = parseSource('github:agent-facets/viper-plans#main')
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
    const result = parseSource('github:agent-facets/viper-plans#abc123def0123456789abc123def0123456789ab')
    expect(result.ok).toBe(true)
    if (result.ok && result.data.type === 'git') {
      expect(result.data.commitish).toBe('abc123def0123456789abc123def0123456789ab')
    }
  })
})

describe('parseSource — git+ URLs', () => {
  test('git+https strips the prefix', () => {
    const result = parseSource('git+https://github.com/agent-facets/viper-plans.git#main')
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
    const result = parseSource('git+ssh://git@github.com/agent-facets/viper-plans.git#v0.1.0')
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
    const result = parseSource('git+https://example.com/facet.git')
    expect(result.ok).toBe(true)
    if (result.ok && result.data.type === 'git') {
      expect(result.data.url).toBe('https://example.com/facet.git')
      expect(result.data.commitish).toBeUndefined()
    }
  })
})

describe('parseSource — bare https git URL', () => {
  test('treated as git when URL contains .git', () => {
    const result = parseSource('https://github.com/agent-facets/viper-plans.git#main')
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

describe('parseSource — local paths', () => {
  test('file:./relative → local path', () => {
    const result = parseSource('file:./facets/viper-plans')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ type: 'local', path: './facets/viper-plans' })
    }
  })

  test('file:../parent → local path', () => {
    const result = parseSource('file:../parent/facet')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ type: 'local', path: '../parent/facet' })
    }
  })

  test('file:/abs → local absolute path', () => {
    const result = parseSource('file:/tmp/some-facet')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ type: 'local', path: '/tmp/some-facet' })
    }
  })
})

describe('parseSource — rejections', () => {
  test('empty string', () => {
    const result = parseSource('')
    expect(result.ok).toBe(false)
  })

  test('bare registry name rejected with roadmap message', () => {
    const result = parseSource('viper-plans')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('registry')
      expect(result.error).toContain('closed alpha')
    }
  })

  test('unknown scheme rejected', () => {
    const result = parseSource('ftp://example.com/facet')
    expect(result.ok).toBe(false)
  })

  // F15 — git URL with a leading `-` would be reinterpreted as a flag by
  // `git clone`. Reject at parse time with a scheme-allowlist check.
  test.each([
    'git+-c core.sshCommand=evil',
    'git+--upload-pack=/bin/sh',
    'git+-oProxyCommand=evil',
  ])('git+ with leading `-` is rejected (%p)', (specifier) => {
    const result = parseSource(specifier)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('must start with')
  })

  test('git+ with empty URL is rejected', () => {
    const result = parseSource('git+')
    expect(result.ok).toBe(false)
  })

  test('git+ with non-allowlisted scheme is rejected', () => {
    const result = parseSource('git+javascript://evil')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('must start with')
  })
})
