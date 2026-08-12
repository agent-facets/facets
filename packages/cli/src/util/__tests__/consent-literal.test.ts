import { describe, expect, test } from 'bun:test'
import { consentCommandLine, consentEnvironmentAssignment, consentLiteral } from '../consent-literal.ts'

/**
 * The consent surfaces are the one place a declaration is shown in full, so
 * these are security assertions rather than formatting ones: what is being
 * checked is that a user can tell two different launches apart, and that a
 * value cannot draw output of its own.
 */

describe('consentLiteral', () => {
  test('an ordinary value is still delimited', () => {
    // Unconditional quoting is what keeps `"a b"` and `a b` from being two
    // renderings of one value.
    expect(consentLiteral('npx')).toBe('"npx"')
  })

  test('an empty value stays visible', () => {
    expect(consentLiteral('')).toBe('""')
  })

  test('whitespace is preserved inside the delimiters', () => {
    expect(consentLiteral('  ')).toBe('"  "')
    expect(consentLiteral('a b')).toBe('"a b"')
  })

  test('newlines and carriage returns cannot add a line', () => {
    expect(consentLiteral('a\nb')).toBe('"a\\nb"')
    expect(consentLiteral('a\rb')).toBe('"a\\rb"')
    expect(consentLiteral('a\nb')).not.toContain('\n')
  })

  test('quotes and backslashes survive unambiguously', () => {
    expect(consentLiteral('a"b')).toBe('"a\\"b"')
    expect(consentLiteral('a\\b')).toBe('"a\\\\b"')
    // The escape itself is escaped, so a value cannot spell an escape.
    expect(consentLiteral('\\n')).toBe('"\\\\n"')
  })

  test('an ANSI escape cannot reach the terminal', () => {
    const rendered = consentLiteral('\u001b[31mred\u001b[0m')
    expect(rendered).not.toContain('\u001b')
    expect(rendered).toContain('red')
  })

  test('a single-byte CSI introducer cannot reach the terminal', () => {
    // `JSON.stringify` leaves the C1 range alone, and `\u009b` IS CSI.
    expect(consentLiteral('\u009b31m')).toBe('"\\u009b31m"')
  })

  test('an OSC sequence cannot set a window title', () => {
    const rendered = consentLiteral('\u001b]0;pwned\u0007')
    expect(rendered).not.toContain('\u001b')
    expect(rendered).not.toContain('\u0007')
  })

  test('DEL, separators, zero-width, and bidi characters are escaped', () => {
    for (const character of ['\u007f', '\u2028', '\u2029', '\u200b', '\u200e', '\u202e', '\u2066', '\ufeff']) {
      const rendered = consentLiteral(character)
      expect(rendered).not.toContain(character)
      expect(rendered).toContain('\\u')
    }
  })

  test('ordinary non-ASCII text is left readable', () => {
    // Escaping is about what a terminal ACTS on, not about what is unfamiliar.
    expect(consentLiteral('café — 日本語')).toBe('"café — 日本語"')
  })
})

describe('consentCommandLine', () => {
  test('distinct argument lists render differently', () => {
    expect(consentCommandLine('srv', ['a b'])).not.toBe(consentCommandLine('srv', ['a', 'b']))
  })

  test('an empty argument occupies a visible position', () => {
    expect(consentCommandLine('srv', ['', 'x'])).toBe('"srv" "" "x"')
  })

  test('a command with no arguments is just the command', () => {
    expect(consentCommandLine('srv', [])).toBe('"srv"')
  })
})

describe('consentEnvironmentAssignment', () => {
  test('the name and the value are delimited separately', () => {
    expect(consentEnvironmentAssignment('TOKEN', 'a b')).toBe('"TOKEN"="a b"')
  })

  test('an equals sign in the value cannot forge a second assignment', () => {
    expect(consentEnvironmentAssignment('A', 'B=C')).toBe('"A"="B=C"')
  })

  test('a newline in the value cannot forge a second line', () => {
    expect(consentEnvironmentAssignment('A', 'x\nB=y')).toBe('"A"="x\\nB=y"')
  })
})
