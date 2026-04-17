import { describe, expect, test } from 'bun:test'
import { getBuiltinNames, parseSpecifier } from '../commands/adapter/specifier.ts'

describe('parseSpecifier', () => {
  test('built-in name "opencode" resolves to npm package', () => {
    const result = parseSpecifier('opencode')
    expect(result).toEqual({ type: 'npm', packageName: '@agent-facets/adapter-opencode' })
  })

  test('built-in name "claude-code" resolves to npm package', () => {
    const result = parseSpecifier('claude-code')
    expect(result).toEqual({ type: 'npm', packageName: '@agent-facets/adapter-claude-code' })
  })

  test('built-in name "codex" resolves to npm package', () => {
    const result = parseSpecifier('codex')
    expect(result).toEqual({ type: 'npm', packageName: '@agent-facets/adapter-codex' })
  })

  test('scoped npm package passes through', () => {
    const result = parseSpecifier('@acme/adapter-custom')
    expect(result).toEqual({ type: 'npm', packageName: '@acme/adapter-custom' })
  })

  test('unscoped npm package passes through', () => {
    const result = parseSpecifier('my-adapter')
    expect(result).toEqual({ type: 'npm', packageName: 'my-adapter' })
  })

  test('git+https URL is parsed', () => {
    const result = parseSpecifier('git+https://github.com/user/repo.git')
    expect(result).toEqual({ type: 'git', url: 'https://github.com/user/repo.git' })
  })

  test('git+ssh URL is parsed', () => {
    const result = parseSpecifier('git+ssh://git@github.com/user/repo.git')
    expect(result).toEqual({ type: 'git', url: 'ssh://git@github.com/user/repo.git' })
  })

  test('git URL with commitish', () => {
    const result = parseSpecifier('git+https://github.com/user/repo.git#v1.0.0')
    expect(result).toEqual({
      type: 'git',
      url: 'https://github.com/user/repo.git',
      commitish: 'v1.0.0',
    })
  })

  test('relative path ./path resolves as local', () => {
    const result = parseSpecifier('./my-adapter')
    expect(result).toEqual({ type: 'local', path: './my-adapter' })
  })

  test('parent path ../path resolves as local', () => {
    const result = parseSpecifier('../adapters/opencode')
    expect(result).toEqual({ type: 'local', path: '../adapters/opencode' })
  })

  test('absolute path resolves as local', () => {
    const result = parseSpecifier('/home/user/adapter')
    expect(result).toEqual({ type: 'local', path: '/home/user/adapter' })
  })
})

describe('getBuiltinNames', () => {
  test('returns all three built-in adapter names', () => {
    const names = getBuiltinNames()
    expect(names).toContain('opencode')
    expect(names).toContain('claude-code')
    expect(names).toContain('codex')
    expect(names).toHaveLength(3)
  })
})
