import { expect, test } from 'bun:test'
import { buildTokensCss } from '../css.ts'

const THEME_TOKENS = [
  '--bg',
  '--bg-elev',
  '--ink',
  '--ink-dim',
  '--ink-faint',
  '--line',
  '--line-strong',
  '--card',
  '--accent-a',
  '--accent-b',
  '--accent-c',
  '--accent-d',
] as const

const FONT_TOKENS = ['--sans', '--mono', '--serif'] as const

function countOccurrences(haystack: string, needle: string): number {
  // Only count property-declaration occurrences (`--foo:`), not incidental
  // mentions, so tests aren't spooked by comments or values containing the
  // same substring.
  return haystack.split(`${needle}:`).length - 1
}

test('buildTokensCss emits both :root and html[data-theme="light"] blocks', () => {
  const css = buildTokensCss()
  expect(css).toContain(':root {')
  expect(css).toContain('html[data-theme="light"] {')
})

test('buildTokensCss declares every theme token exactly twice', () => {
  const css = buildTokensCss()
  for (const token of THEME_TOKENS) {
    expect(countOccurrences(css, token)).toBe(2)
  }
})

test('buildTokensCss declares every font-stack token exactly once', () => {
  const css = buildTokensCss()
  for (const token of FONT_TOKENS) {
    expect(countOccurrences(css, token)).toBe(1)
  }
})

test('buildTokensCss uses the correct dark + light --bg values', () => {
  const css = buildTokensCss()
  // Dark --bg sits in :root.
  expect(css).toMatch(/:root\s*\{[^}]*--bg:\s*#0a0a12/)
  // Light --bg sits in the theme override block.
  expect(css).toMatch(/html\[data-theme="light"\]\s*\{[^}]*--bg:\s*#f6f4ef/)
})

test('buildTokensCss is deterministic', () => {
  expect(buildTokensCss()).toBe(buildTokensCss())
})
