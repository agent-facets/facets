import { describe, expect, test } from 'bun:test'
import { resolvesToLatest } from '@agent-facets/protocol'
import { parseVersionSpec } from '../parse-version.ts'

describe('parseVersionSpec — accepted forms', () => {
  test('exact semver', () => {
    const result = parseVersionSpec('1.2.3')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'exact', major: 1, minor: 2, patch: 3 })
  })

  test('exact semver with multi-digit components', () => {
    const result = parseVersionSpec('10.20.30')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'exact', major: 10, minor: 20, patch: 30 })
  })

  test('major wildcard', () => {
    const result = parseVersionSpec('1.*')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'majorWildcard', major: 1 })
  })

  test('minor wildcard', () => {
    const result = parseVersionSpec('1.2.*')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'minorWildcard', major: 1, minor: 2 })
  })

  test('bare wildcard', () => {
    const result = parseVersionSpec('*')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'wildcard' })
  })

  test('latest tag', () => {
    const result = parseVersionSpec('latest')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ kind: 'latest' })
  })
})

describe('parseVersionSpec — rejected forms', () => {
  test('empty string', () => {
    const result = parseVersionSpec('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EMPTY')
  })

  test.each(['^1.2.3', '^1.0.0', '^0.0.1'])('caret range %p', (input) => {
    const result = parseVersionSpec(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CARET_RANGE')
  })

  test.each(['~1.2.3', '~1.0.0'])('tilde range %p', (input) => {
    const result = parseVersionSpec(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TILDE_RANGE')
  })

  test.each(['>=1.0.0', '<2.0.0', '<=1.5.0', '>1.0.0'])('comparator range %p', (input) => {
    const result = parseVersionSpec(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('COMPARATOR_RANGE')
  })

  test('OR range', () => {
    const result = parseVersionSpec('1.0.0 || 2.0.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('OR_RANGE')
  })

  test('hyphen range', () => {
    const result = parseVersionSpec('1.0.0 - 2.0.0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('COMPARATOR_RANGE')
  })

  test.each(['1.x', '1.X', '1.2.x', '1.2.X'])('x-style range %p', (input) => {
    const result = parseVersionSpec(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('X_RANGE')
  })

  test.each(['1.2', '1', '1.2.3.4', 'abc', '1.2.3-rc.1', '1.2.3+build'])('invalid version %p', (input) => {
    const result = parseVersionSpec(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_VERSION')
  })
})

describe('resolvesToLatest', () => {
  test('wildcard resolves to latest', () => {
    expect(resolvesToLatest({ kind: 'wildcard' })).toBe(true)
  })

  test('latest tag resolves to latest', () => {
    expect(resolvesToLatest({ kind: 'latest' })).toBe(true)
  })

  test('exact does not resolve to latest', () => {
    expect(resolvesToLatest({ kind: 'exact', major: 1, minor: 2, patch: 3 })).toBe(false)
  })

  test('majorWildcard does not resolve to latest', () => {
    expect(resolvesToLatest({ kind: 'majorWildcard', major: 1 })).toBe(false)
  })

  test('minorWildcard does not resolve to latest', () => {
    expect(resolvesToLatest({ kind: 'minorWildcard', major: 1, minor: 2 })).toBe(false)
  })
})
