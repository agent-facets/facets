import { describe, expect, test } from 'bun:test'
import { jsonFileText } from '../json-file-text.ts'

describe('jsonFileText', () => {
  test('serializes with 2-space indentation and a trailing newline', () => {
    expect(jsonFileText({ a: 1 })).toBe('{\n  "a": 1\n}\n')
  })

  test('always ends with exactly one newline', () => {
    const text = jsonFileText({ nested: { list: [1, 2] } })
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  test('round-trips through JSON.parse', () => {
    const value = { facets: { cowsay: '0.1.1' } }
    expect(JSON.parse(jsonFileText(value))).toEqual(value)
  })
})
