import { describe, expect, test } from 'bun:test'
import { packTokens, wrap } from '../format.ts'

describe('wrap', () => {
  test('narrows later rows for a hanging indent', () => {
    expect(wrap('aaa bbb ccc ddd', 7, 5)).toEqual(['aaa bbb', 'ccc', 'ddd'])
  })

  test('a word split across rows is never rejoined with a space', () => {
    const rows = wrap('https://xn--nthropic-06g.com/mcp', 18, 16)
    expect(rows.join('')).toBe('https://xn--nthropic-06g.com/mcp')
    expect(rows.every((row) => !row.includes(' '))).toBe(true)
  })
})

describe('packTokens', () => {
  test('keeps whitespace inside a token', () => {
    expect(packTokens(['stdio', '·', 'npx', "'a  b'"], 80)).toEqual(["stdio · npx 'a  b'"])
  })

  test('breaks only between tokens and never splits a long one', () => {
    expect(packTokens(['http', '·', 'https://example.test/a/very/long/path'], 12, 10)).toEqual([
      'http ·',
      'https://example.test/a/very/long/path',
    ])
  })
})
