import { describe, expect, test } from 'bun:test'
import { parseSpecifier } from '../specifier.ts'

describe('parseSpecifier — built-in aliases', () => {
  test('opencode resolves to the npm package', () => {
    expect(parseSpecifier('opencode')).toEqual({
      type: 'npm',
      packageName: '@agent-facets/adapter-opencode',
    })
  })

  test('claude-code resolves to the npm package', () => {
    expect(parseSpecifier('claude-code')).toEqual({
      type: 'npm',
      packageName: '@agent-facets/adapter-claude-code',
    })
  })
})

describe('parseSpecifier — git URLs', () => {
  test('git+https with ref', () => {
    expect(parseSpecifier('git+https://example.com/adapter.git#v1')).toEqual({
      type: 'git',
      url: 'https://example.com/adapter.git',
      commitish: 'v1',
    })
  })

  test('git+ssh without ref', () => {
    expect(parseSpecifier('git+ssh://git@example.com/adapter.git')).toEqual({
      type: 'git',
      url: 'ssh://git@example.com/adapter.git',
    })
  })

  // F15: URLs with disallowed schemes — especially anything starting with `-`
  // that git would interpret as a flag — must be rejected before the URL
  // reaches the spawn call.
  test.each([
    'git+-c core.sshCommand=evil',
    'git+--upload-pack=/bin/sh',
    'git+javascript:alert(1)',
    'git+ftp://example.com/repo.git',
  ])('rejects git+ URL with disallowed scheme (%p)', (specifier) => {
    expect(() => parseSpecifier(specifier)).toThrow(/must start with/)
  })
})

describe('parseSpecifier — local and npm', () => {
  test('relative path', () => {
    expect(parseSpecifier('./local/adapter')).toEqual({
      type: 'local',
      path: './local/adapter',
    })
  })

  test('absolute path', () => {
    expect(parseSpecifier('/abs/adapter')).toEqual({
      type: 'local',
      path: '/abs/adapter',
    })
  })

  test('scoped npm package', () => {
    expect(parseSpecifier('@scope/my-adapter')).toEqual({
      type: 'npm',
      packageName: '@scope/my-adapter',
    })
  })

  test('bare npm package', () => {
    expect(parseSpecifier('some-adapter')).toEqual({
      type: 'npm',
      packageName: 'some-adapter',
    })
  })
})
