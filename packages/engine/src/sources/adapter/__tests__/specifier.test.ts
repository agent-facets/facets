import { describe, expect, test } from 'bun:test'
import { getBuiltinAdapterNames, parseAdapterSpecifier } from '../specifier.ts'

describe('parseAdapterSpecifier — built-in aliases', () => {
  test('opencode resolves to the npm package', () => {
    const result = parseAdapterSpecifier('opencode')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@agent-facets/adapter-opencode',
    })
  })

  test('claude-code resolves to the npm package', () => {
    const result = parseAdapterSpecifier('claude-code')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@agent-facets/adapter-claude-code',
    })
  })

  test('codex resolves to the npm package', () => {
    const result = parseAdapterSpecifier('codex')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@agent-facets/adapter-codex',
    })
  })
})

describe('parseAdapterSpecifier — git URLs', () => {
  test('git+https with ref', () => {
    const result = parseAdapterSpecifier('git+https://example.com/adapter.git#v1')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'git',
      url: 'https://example.com/adapter.git',
      commitish: 'v1',
    })
  })

  test('git+ssh without ref', () => {
    const result = parseAdapterSpecifier('git+ssh://git@example.com/adapter.git')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
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
    const result = parseAdapterSpecifier(specifier)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('invalid-git-url')
    expect(result.specifier).toBe(specifier)
  })
})

describe('parseAdapterSpecifier — local and npm', () => {
  test('relative path', () => {
    const result = parseAdapterSpecifier('./local/adapter')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'local',
      path: './local/adapter',
    })
  })

  test('absolute path', () => {
    const result = parseAdapterSpecifier('/abs/adapter')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'local',
      path: '/abs/adapter',
    })
  })

  test('scoped npm package', () => {
    const result = parseAdapterSpecifier('@scope/my-adapter')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@scope/my-adapter',
    })
  })

  test('bare npm package', () => {
    const result = parseAdapterSpecifier('some-adapter')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: 'some-adapter',
    })
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
