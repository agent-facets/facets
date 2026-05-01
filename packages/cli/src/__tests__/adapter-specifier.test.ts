import { describe, expect, test } from 'bun:test'
import { getBuiltinAdapterNames, parseAdapterSpecifier } from '@agent-facets/core'

describe('parseAdapterSpecifier', () => {
  test('built-in name "opencode" resolves to npm package', () => {
    const result = parseAdapterSpecifier('opencode')
    expect(result).toEqual({ type: 'npm', packageName: '@agent-facets/adapter-opencode' })
  })

  test('built-in name "claude-code" resolves to npm package', () => {
    const result = parseAdapterSpecifier('claude-code')
    expect(result).toEqual({ type: 'npm', packageName: '@agent-facets/adapter-claude-code' })
  })

  test('built-in name "codex" resolves to npm package', () => {
    const result = parseAdapterSpecifier('codex')
    expect(result).toEqual({ type: 'npm', packageName: '@agent-facets/adapter-codex' })
  })

  test('scoped npm package passes through', () => {
    const result = parseAdapterSpecifier('@acme/adapter-custom')
    expect(result).toEqual({ type: 'npm', packageName: '@acme/adapter-custom' })
  })

  test('unscoped npm package passes through', () => {
    const result = parseAdapterSpecifier('my-adapter')
    expect(result).toEqual({ type: 'npm', packageName: 'my-adapter' })
  })

  test('git+https URL is parsed', () => {
    const result = parseAdapterSpecifier('git+https://github.com/user/repo.git')
    expect(result).toEqual({ type: 'git', url: 'https://github.com/user/repo.git' })
  })

  test('git+ssh URL is parsed', () => {
    const result = parseAdapterSpecifier('git+ssh://git@github.com/user/repo.git')
    expect(result).toEqual({ type: 'git', url: 'ssh://git@github.com/user/repo.git' })
  })

  test('git URL with commitish', () => {
    const result = parseAdapterSpecifier('git+https://github.com/user/repo.git#v1.0.0')
    expect(result).toEqual({
      type: 'git',
      url: 'https://github.com/user/repo.git',
      commitish: 'v1.0.0',
    })
  })

  test('relative path ./path resolves as local', () => {
    const result = parseAdapterSpecifier('./my-adapter')
    expect(result).toEqual({ type: 'local', path: './my-adapter' })
  })

  test('parent path ../path resolves as local', () => {
    const result = parseAdapterSpecifier('../adapters/opencode')
    expect(result).toEqual({ type: 'local', path: '../adapters/opencode' })
  })

  test('absolute path resolves as local', () => {
    const result = parseAdapterSpecifier('/home/user/adapter')
    expect(result).toEqual({ type: 'local', path: '/home/user/adapter' })
  })
})

describe('getBuiltinAdapterNames', () => {
  test('returns all three built-in adapter names', () => {
    const names = getBuiltinAdapterNames()
    expect(names).toContain('opencode')
    expect(names).toContain('claude-code')
    expect(names).toContain('codex')
    expect(names).toHaveLength(3)
  })
})
