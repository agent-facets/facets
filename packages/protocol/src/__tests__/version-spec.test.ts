import { describe, expect, test } from 'bun:test'
import {
  isSafeVersionComponent,
  MAX_VERSION_COMPONENT,
  resolvesToLatest,
  satisfies,
  type VersionSpec,
} from '@agent-facets/protocol'

const v = (major: number, minor: number, patch: number) => ({ major, minor, patch })

describe('isSafeVersionComponent', () => {
  test('accepts ordinary components', () => {
    expect(isSafeVersionComponent('0')).toBe(true)
    expect(isSafeVersionComponent('1')).toBe(true)
    expect(isSafeVersionComponent('4294967296')).toBe(true)
  })

  test('accepts the largest representable component', () => {
    expect(MAX_VERSION_COMPONENT).toBe(Number.MAX_SAFE_INTEGER)
    expect(isSafeVersionComponent('9007199254740991')).toBe(true)
  })

  test('rejects the first component that cannot be told apart from its successor', () => {
    // The bound is not arbitrary: these two distinct releases are the
    // same double, which is precisely what the predicate exists to stop.
    expect(Number('9007199254740992')).toBe(Number('9007199254740993'))
    expect(isSafeVersionComponent('9007199254740992')).toBe(false)
    expect(isSafeVersionComponent('9007199254740993')).toBe(false)
  })

  test('rejects components far above the bound', () => {
    expect(isSafeVersionComponent('99999999999999999999')).toBe(false)
  })

  test('compares magnitude rather than digits', () => {
    // Same length as the bound, lexically larger only in a later digit.
    expect(isSafeVersionComponent('9007199254740990')).toBe(true)
    expect(isSafeVersionComponent('9999999999999999')).toBe(false)
  })

  test('ignores leading zeros when judging magnitude', () => {
    expect(isSafeVersionComponent('0000000000000000001')).toBe(true)
    expect(isSafeVersionComponent('09007199254740992')).toBe(false)
  })

  test('rejects anything that is not a bare run of decimal digits', () => {
    expect(isSafeVersionComponent('')).toBe(false)
    expect(isSafeVersionComponent('1.2')).toBe(false)
    expect(isSafeVersionComponent('-1')).toBe(false)
    expect(isSafeVersionComponent('1e3')).toBe(false)
    expect(isSafeVersionComponent(' 1')).toBe(false)
  })
})

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
