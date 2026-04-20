import { describe, expect, test } from 'bun:test'
import { validateAssetName } from '../asset-name.ts'

describe('validateAssetName', () => {
  test('accepts a plain name', () => {
    expect(validateAssetName('planning')).toEqual({ ok: true })
  })

  test('accepts a namespaced name with forward slashes', () => {
    expect(validateAssetName('viper-plans/planning')).toEqual({ ok: true })
  })

  test('rejects single-dot segment', () => {
    const result = validateAssetName('./planning')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/segments/)
  })

  test('rejects double-dot segment anywhere in the path', () => {
    for (const bad of ['../escape', 'a/../b', 'deep/../../esc']) {
      const result = validateAssetName(bad)
      expect(result.ok).toBe(false)
    }
  })

  test('rejects empty segments (leading, trailing, double slash)', () => {
    for (const bad of ['/leading', 'trailing/', 'a//b']) {
      const result = validateAssetName(bad)
      expect(result.ok).toBe(false)
    }
  })

  test('rejects backslash as a separator — Windows path traversal vector', () => {
    for (const bad of ['..\\escape', 'a\\b', 'deep\\..\\esc']) {
      const result = validateAssetName(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/backslash/)
    }
  })

  test('accepts names with dots inside a segment (not as the whole segment)', () => {
    expect(validateAssetName('foo.bar')).toEqual({ ok: true })
    expect(validateAssetName('a/foo.bar/b')).toEqual({ ok: true })
  })
})
