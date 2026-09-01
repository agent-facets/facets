import { describe, expect, test } from 'bun:test'
import { compareExactVersions, isNewerThan, parseExactVersion } from '../version-order.ts'

const at = (major: number, minor: number, patch: number) => ({ kind: 'exact' as const, major, minor, patch })

describe('parseExactVersion', () => {
  test('accepts an exact MAJOR.MINOR.PATCH', () => {
    expect(parseExactVersion('1.2.3')).toEqual(at(1, 2, 3))
  })

  test.each(['1.*', '1.2.*', '*', 'latest'])('rejects the non-exact form %p', (form) => {
    expect(parseExactVersion(form)).toBeUndefined()
  })

  test.each([
    '',
    '1.2',
    '1.2.3.4',
    'v1.2.3',
    '1.2.3-rc.1',
    '^1.2.3',
    'nonsense',
  ])('rejects the unusable value %p', (value) => {
    expect(parseExactVersion(value)).toBeUndefined()
  })

  test('never throws on hand-edited lockfile text', () => {
    // The point of this parser existing alongside `parseLockedVersion`:
    // that one throws, because the lockfile schema promised it wouldn't
    // have to. This one is handed values nothing has narrowed yet.
    expect(() => parseExactVersion('garbage')).not.toThrow()
  })
})

describe('compareExactVersions', () => {
  test('orders by major first', () => {
    expect(compareExactVersions(at(2, 0, 0), at(1, 9, 9))).toBeGreaterThan(0)
  })

  test('orders by minor when majors match', () => {
    expect(compareExactVersions(at(1, 2, 0), at(1, 3, 0))).toBeLessThan(0)
  })

  test('orders by patch when major and minor match', () => {
    expect(compareExactVersions(at(1, 2, 5), at(1, 2, 4))).toBeGreaterThan(0)
  })

  test('is zero for the same release', () => {
    expect(compareExactVersions(at(1, 2, 3), at(1, 2, 3))).toBe(0)
  })

  test('compares components numerically, not as text', () => {
    // The trap `compareCodeUnits` would fall into: "1.10.0" sorts below
    // "1.9.0" as a string, which would hide a real update.
    expect(compareExactVersions(at(1, 10, 0), at(1, 9, 0))).toBeGreaterThan(0)
    expect(compareExactVersions(at(10, 0, 0), at(9, 0, 0))).toBeGreaterThan(0)
    expect(compareExactVersions(at(1, 2, 10), at(1, 2, 9))).toBeGreaterThan(0)
  })
})

describe('isNewerThan', () => {
  test('is true only for a strictly newer version', () => {
    expect(isNewerThan(at(1, 3, 0), at(1, 2, 0))).toBe(true)
  })

  test('is false for the same version', () => {
    expect(isNewerThan(at(1, 2, 0), at(1, 2, 0))).toBe(false)
  })

  test('is false for an older version, so nothing can be downgraded', () => {
    expect(isNewerThan(at(1, 1, 0), at(1, 2, 0))).toBe(false)
  })
})
