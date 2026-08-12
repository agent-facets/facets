import { describe, expect, test } from 'bun:test'
import { terminalCommandLine, terminalEnvironmentAssignment, terminalLiteral } from '../terminal.ts'

/**
 * The surfaces that reproduce a declaration value are the ones a user decides
 * from, so these are security assertions rather than formatting ones: what is
 * being checked is that a user can tell two different launches apart, that a
 * value cannot draw output of its own, and that nothing is lost on the way.
 */

describe('terminalLiteral', () => {
  test('an ordinary value is still delimited', () => {
    // Unconditional quoting is what keeps `"a b"` and `a b` from being two
    // renderings of one value.
    expect(terminalLiteral('npx')).toBe('"npx"')
  })

  test('an empty value stays visible', () => {
    expect(terminalLiteral('')).toBe('""')
  })

  test('whitespace is preserved inside the delimiters', () => {
    expect(terminalLiteral('  ')).toBe('"  "')
    expect(terminalLiteral('a b')).toBe('"a b"')
  })

  test('newlines and carriage returns cannot add a line', () => {
    expect(terminalLiteral('a\nb')).toBe('"a\\nb"')
    expect(terminalLiteral('a\rb')).toBe('"a\\rb"')
    expect(terminalLiteral('a\nb')).not.toContain('\n')
  })

  test('quotes and backslashes survive unambiguously', () => {
    expect(terminalLiteral('a"b')).toBe('"a\\"b"')
    expect(terminalLiteral('a\\b')).toBe('"a\\\\b"')
    // The escape itself is escaped, so a value cannot spell an escape.
    expect(terminalLiteral('\\n')).toBe('"\\\\n"')
  })

  test('an ANSI escape cannot reach the terminal', () => {
    const rendered = terminalLiteral('\u001b[31mred\u001b[0m')
    expect(rendered).not.toContain('\u001b')
    expect(rendered).toContain('red')
  })

  test('a single-byte CSI introducer cannot reach the terminal', () => {
    // `JSON.stringify` leaves the C1 range alone, and `\u009b` IS CSI.
    expect(terminalLiteral('\u009b31m')).toBe('"\\u009b31m"')
  })

  test('an OSC sequence cannot set a window title', () => {
    const rendered = terminalLiteral('\u001b]0;pwned\u0007')
    expect(rendered).not.toContain('\u001b')
    expect(rendered).not.toContain('\u0007')
  })

  test('DEL, separators, zero-width, and bidi characters are escaped', () => {
    for (const character of ['\u007f', '\u2028', '\u2029', '\u200b', '\u200e', '\u202e', '\u2066', '\ufeff']) {
      const rendered = terminalLiteral(character)
      expect(rendered).not.toContain(character)
      expect(rendered).toContain('\\u')
    }
  })

  test('the characters a denylist missed are escaped', () => {
    // The two that motivated the switch to an allowlist: `\u061c` reorders the
    // text around it, and `\u2060` draws nothing at all. Both let two distinct
    // declarations render identically.
    expect(terminalLiteral('a\u061cb')).toBe('"a\\u061cb"')
    expect(terminalLiteral('a\u2060b')).toBe('"a\\u2060b"')
  })

  test('ordinary non-ASCII text is escaped rather than drawn', () => {
    // Fail-closed: a rendering that draws unfamiliar scripts has to be right
    // about every one of them, and the two above are proof that being right
    // about all of them is not achievable by enumeration.
    expect(terminalLiteral('café')).toBe('"caf\\u00e9"')
  })

  test('the rendering contains printable ASCII only', () => {
    const values = ['café — 日本語', '\u001b[2K', '\u{1f600}', '\u061c\u2060\ufeff', '\ud800', 'ordinary']
    for (const value of values) {
      expect(terminalLiteral(value)).toMatch(/^[\u0020-\u007e]*$/)
    }
  })

  test('the complete value survives escaping', () => {
    // Escaping preserves; it does not redact, truncate, or normalize. A user
    // approving a rendering is approving exactly this string.
    const values = ['café — 日本語', 'a\nb', '\u001b[31m', '\u{1f600}', '\u061c', '', '  ']
    for (const value of values) {
      expect(JSON.parse(terminalLiteral(value))).toBe(value)
    }
  })

  test('an astral character round-trips through its surrogate pair', () => {
    expect(terminalLiteral('\u{1f600}')).toBe('"\\ud83d\\ude00"')
    expect(JSON.parse(terminalLiteral('\u{1f600}'))).toBe('\u{1f600}')
  })

  test('a lone surrogate is escaped rather than emitted', () => {
    // `JSON.stringify` renders an unpaired surrogate as `\ud800` itself, but
    // the assertion that matters is that nothing unpaired reaches the output.
    const rendered = terminalLiteral('\ud800')
    expect(rendered).toBe('"\\ud800"')
    expect(rendered).toMatch(/^[\u0020-\u007e]*$/)
  })
})

describe('terminalCommandLine', () => {
  test('distinct argument lists render differently', () => {
    expect(terminalCommandLine('srv', ['a b'])).not.toBe(terminalCommandLine('srv', ['a', 'b']))
  })

  test('an empty argument occupies a visible position', () => {
    expect(terminalCommandLine('srv', ['', 'x'])).toBe('"srv" "" "x"')
  })

  test('a command with no arguments is just the command', () => {
    expect(terminalCommandLine('srv', [])).toBe('"srv"')
  })
})

describe('terminalEnvironmentAssignment', () => {
  test('the name and the value are delimited separately', () => {
    expect(terminalEnvironmentAssignment('TOKEN', 'a b')).toBe('"TOKEN"="a b"')
  })

  test('an equals sign in the value cannot forge a second assignment', () => {
    expect(terminalEnvironmentAssignment('A', 'B=C')).toBe('"A"="B=C"')
  })

  test('a newline in the value cannot forge a second line', () => {
    expect(terminalEnvironmentAssignment('A', 'x\nB=y')).toBe('"A"="x\\nB=y"')
  })
})
