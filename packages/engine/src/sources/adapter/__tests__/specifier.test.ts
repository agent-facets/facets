import { describe, expect, test } from 'bun:test'
import { FIRST_PARTY_ADAPTERS } from '../../../adapters/first-party.ts'
import { getBuiltinAdapterNames, parseAdapterSpecifier } from '../specifier.ts'

describe('parseAdapterSpecifier — built-in aliases', () => {
  test('every first-party catalog entry resolves to its npm package', () => {
    // The catalog is the single source of truth for aliases: this test
    // holds for any adapter added to (or removed from) the catalog.
    expect(FIRST_PARTY_ADAPTERS.length).toBeGreaterThan(0)
    for (const adapter of FIRST_PARTY_ADAPTERS) {
      const result = parseAdapterSpecifier(adapter.name)
      if (!result.ok) expect.unreachable()
      expect(result.resolved).toEqual({
        type: 'npm',
        packageName: adapter.npmPackage,
        request: { kind: 'implicit' },
      })
    }
  })

  test('alias composes with a version selector', () => {
    const result = parseAdapterSpecifier('opencode@1.*')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@agent-facets/adapter-opencode',
      request: { kind: 'selector', spec: { kind: 'majorWildcard', major: 1 }, raw: '1.*' },
    })
  })

  test('alias composes with an exact version', () => {
    const result = parseAdapterSpecifier('codex@1.2.3')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@agent-facets/adapter-codex',
      request: { kind: 'exact', major: 1, minor: 2, patch: 3, raw: '1.2.3' },
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

describe('parseAdapterSpecifier — local paths', () => {
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
})

describe('parseAdapterSpecifier — npm packages', () => {
  test('scoped npm package stays a bare package', () => {
    const result = parseAdapterSpecifier('@scope/my-adapter')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@scope/my-adapter',
      request: { kind: 'implicit' },
    })
  })

  test('bare npm package is an implicit request', () => {
    const result = parseAdapterSpecifier('some-adapter')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: 'some-adapter',
      request: { kind: 'implicit' },
    })
  })

  test('scoped npm package splits the selector after the package name', () => {
    const result = parseAdapterSpecifier('@scope/my-adapter@1.2.*')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@scope/my-adapter',
      request: { kind: 'selector', spec: { kind: 'minorWildcard', major: 1, minor: 2 }, raw: '1.2.*' },
    })
  })

  test('bare npm package with exact version', () => {
    const result = parseAdapterSpecifier('some-adapter@2.0.1')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: 'some-adapter',
      request: { kind: 'exact', major: 2, minor: 0, patch: 1, raw: '2.0.1' },
    })
  })

  test('bare wildcard selector', () => {
    const result = parseAdapterSpecifier('some-adapter@*')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: 'some-adapter',
      request: { kind: 'selector', spec: { kind: 'wildcard' }, raw: '*' },
    })
  })

  test('explicit latest selector', () => {
    const result = parseAdapterSpecifier('@scope/my-adapter@latest')
    if (!result.ok) expect.unreachable()
    expect(result.resolved).toEqual({
      type: 'npm',
      packageName: '@scope/my-adapter',
      request: { kind: 'selector', spec: { kind: 'latest' }, raw: 'latest' },
    })
  })
})

describe('parseAdapterSpecifier — rejected npm selectors', () => {
  test.each([
    ['some-adapter@^1.0.0', 'CARET_RANGE'],
    ['some-adapter@~1.2.0', 'TILDE_RANGE'],
    ['some-adapter@>=1.0.0', 'COMPARATOR_RANGE'],
    ['some-adapter@1.0.0 || 2.0.0', 'OR_RANGE'],
    ['some-adapter@1.0.0 - 2.0.0', 'COMPARATOR_RANGE'],
    ['some-adapter@1.x', 'X_RANGE'],
    ['@scope/my-adapter@1.2.x', 'X_RANGE'],
    ['some-adapter@1.2.3-rc.1', 'INVALID_VERSION'],
    ['some-adapter@', 'EMPTY'],
  ])('rejects %s with %s', (specifier, code) => {
    const result = parseAdapterSpecifier(specifier)
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid-npm-selector') expect.unreachable()
    expect(result.error.code).toBe(code as never)
    expect(result.specifier).toBe(specifier)
  })

  test('rejected selector reports the alias-resolved package name', () => {
    const result = parseAdapterSpecifier('opencode@^1.0.0')
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid-npm-selector') expect.unreachable()
    expect(result.packageName).toBe('@agent-facets/adapter-opencode')
    expect(result.selector).toBe('^1.0.0')
  })
})

describe('getBuiltinAdapterNames', () => {
  test('derives from the first-party catalog', () => {
    expect(getBuiltinAdapterNames()).toEqual(FIRST_PARTY_ADAPTERS.map((adapter) => adapter.name))
  })
})
