import { describe, expect, test } from 'bun:test'
import { normalizeLineEndings } from '../text.ts'

describe('normalizeLineEndings', () => {
  test('strips a leading UTF-8 BOM', () => {
    expect(normalizeLineEndings('\uFEFFhello')).toBe('hello')
  })

  test('converts CRLF to LF', () => {
    expect(normalizeLineEndings('a\r\nb\r\nc')).toBe('a\nb\nc')
  })

  test('converts lone CR to LF', () => {
    expect(normalizeLineEndings('a\rb\rc')).toBe('a\nb\nc')
  })

  test('returns already-normalized input unchanged', () => {
    const input = 'line 1\nline 2\nline 3'
    expect(normalizeLineEndings(input)).toBe(input)
  })

  test('is idempotent', () => {
    const raw = '\uFEFFa\r\nb\rc'
    const once = normalizeLineEndings(raw)
    const twice = normalizeLineEndings(once)
    expect(twice).toBe(once)
  })
})
