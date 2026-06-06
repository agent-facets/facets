import { describe, expect, test } from 'bun:test'
import { parseLockedVersion } from '../parse-locked-version.ts'

describe('parseLockedVersion', () => {
  test('parses an exact M.N.P into a structured exact VersionSpec', () => {
    expect(parseLockedVersion('1.2.3')).toEqual({ kind: 'exact', major: 1, minor: 2, patch: 3 })
  })

  test('parses multi-digit components', () => {
    expect(parseLockedVersion('10.20.30')).toEqual({ kind: 'exact', major: 10, minor: 20, patch: 30 })
  })

  test('parses 0.0.0', () => {
    expect(parseLockedVersion('0.0.0')).toEqual({ kind: 'exact', major: 0, minor: 0, patch: 0 })
  })

  test('throws on a non-M.N.P string (schema/parser drift is a programmer bug)', () => {
    // Lockfile schema narrows `version` to M.N.P, so this is unreachable on
    // validated input — the throw guards against schema/parser drift.
    expect(() => parseLockedVersion('1.2')).toThrow('parseLockedVersion regex rejected it')
    expect(() => parseLockedVersion('1.2.3-rc.1')).toThrow()
    expect(() => parseLockedVersion('latest')).toThrow()
  })
})
