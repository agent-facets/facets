import { describe, expect, test } from 'bun:test'
import { resolvesToLatest, satisfies, type VersionSpec } from '@agent-facets/protocol'

const v = (major: number, minor: number, patch: number) => ({ major, minor, patch })

describe('satisfies — exact specifier', () => {
  const spec: VersionSpec = { kind: 'exact', major: 1, minor: 2, patch: 3 }

  test('matches when all components are equal', () => {
    expect(satisfies(v(1, 2, 3), spec)).toBe(true)
  })

  test('does not match a different patch', () => {
    expect(satisfies(v(1, 2, 4), spec)).toBe(false)
  })

  test('does not match a different minor', () => {
    expect(satisfies(v(1, 3, 3), spec)).toBe(false)
  })

  test('does not match a different major', () => {
    expect(satisfies(v(2, 2, 3), spec)).toBe(false)
  })

  test('the reported bug: 0.1.1 does not satisfy exact 0.1.2', () => {
    const bumped: VersionSpec = { kind: 'exact', major: 0, minor: 1, patch: 2 }
    expect(satisfies(v(0, 1, 1), bumped)).toBe(false)
  })
})

describe('satisfies — majorWildcard specifier', () => {
  const spec: VersionSpec = { kind: 'majorWildcard', major: 1 }

  test('matches any version sharing the major', () => {
    expect(satisfies(v(1, 0, 0), spec)).toBe(true)
    expect(satisfies(v(1, 9, 9), spec)).toBe(true)
  })

  test('does not match a different major', () => {
    expect(satisfies(v(2, 0, 0), spec)).toBe(false)
    expect(satisfies(v(0, 1, 1), spec)).toBe(false)
  })
})

describe('satisfies — minorWildcard specifier', () => {
  const spec: VersionSpec = { kind: 'minorWildcard', major: 1, minor: 2 }

  test('matches any version sharing major and minor', () => {
    expect(satisfies(v(1, 2, 0), spec)).toBe(true)
    expect(satisfies(v(1, 2, 99), spec)).toBe(true)
  })

  test('does not match a different minor', () => {
    expect(satisfies(v(1, 3, 0), spec)).toBe(false)
  })

  test('does not match a different major', () => {
    expect(satisfies(v(2, 2, 0), spec)).toBe(false)
  })
})

describe('satisfies — unconstrained specifiers', () => {
  test('wildcard is always satisfied', () => {
    const spec: VersionSpec = { kind: 'wildcard' }
    expect(satisfies(v(0, 0, 1), spec)).toBe(true)
    expect(satisfies(v(99, 99, 99), spec)).toBe(true)
  })

  test('latest is always satisfied', () => {
    const spec: VersionSpec = { kind: 'latest' }
    expect(satisfies(v(0, 0, 1), spec)).toBe(true)
    expect(satisfies(v(99, 99, 99), spec)).toBe(true)
  })

  test('agrees with resolvesToLatest on which specifiers are unconstrained', () => {
    const wildcard: VersionSpec = { kind: 'wildcard' }
    const latest: VersionSpec = { kind: 'latest' }
    expect(resolvesToLatest(wildcard)).toBe(true)
    expect(resolvesToLatest(latest)).toBe(true)
  })
})
