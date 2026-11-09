import { describe, expect, test } from 'bun:test'
import { safeText, shellQuote, toTerminalSafe } from '../terminal-safe.ts'

// Built from code points: as literals these characters are invisible in review, and
// the formatter's autofix rewrites `\u` escapes for them into literals.
const RLO = String.fromCodePoint(0x202e)
const BOM = String.fromCodePoint(0xfeff)
const ZWSP = String.fromCodePoint(0x200b)

describe('toTerminalSafe', () => {
  test.each([
    ['CSI concealed text', 'a\u001b[8mhidden\u001b[0mb', 'a^[[8mhidden^[[0mb', 2],
    [
      'OSC 8 hyperlink',
      '\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007',
      '^[]8;;https://evil.test^Gclick^[]8;;^G',
      4,
    ],
    ['OSC 52 clipboard', '\u001b]52;c;cm0gLXJm\u0007', '^[]52;c;cm0gLXJm^G', 2],
    ['lone carriage return', 'safe\rrm -rf', 'safe^Mrm -rf', 1],
    ['DEL', 'a\u007fb', 'a^?b', 1],
    ['C1 CSI in UTF-8 form', 'a\u009b2Jb', 'a<U+009B>2Jb', 1],
    ['right-to-left override', `file${RLO}txt.exe`, 'file<U+202E>txt.exe', 1],
    ['zero-width space and BOM', `${BOM}a${ZWSP}b`, '<U+FEFF>a<U+200B>b', 2],
  ])('%s is made visible', (_label, input, expected, count) => {
    expect(toTerminalSafe(input)).toEqual({ text: expected, escaped: count })
  })

  test('line feeds, tabs, CRLF, and ordinary Unicode pass through untouched', () => {
    const text = 'one\ttwo\r\nthree — héllo 🐄\n'
    expect(toTerminalSafe(text)).toEqual({ text, escaped: 0 })
  })

  test('the output contains no control bytes', () => {
    const hostile = `${Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)).join('')}\u007f\u0085`
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence.
    expect(safeText(hostile)).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
  })

  test.each([
    ['tag characters spelling "hi"', [0xe0068, 0xe0069]],
    ['left-to-right and right-to-left marks', [0x200e, 0x200f]],
    ['Arabic letter mark', [0x061c]],
    ['line and paragraph separators', [0x2028, 0x2029]],
    ['soft hyphen', [0x00ad]],
    ['invisible operators', [0x2061, 0x2062, 0x2063, 0x2064]],
    ['supplementary variation selector', [0xe0100]],
    ['Hangul filler', [0x3164]],
    ['braille blank', [0x2800]],
  ])('%s are made visible', (_label, codes) => {
    const hidden = String.fromCodePoint(...codes)
    const expected = codes.map((code) => `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`).join('')
    expect(toTerminalSafe(`a${hidden}b`)).toEqual({ text: `a${expected}b`, escaped: codes.length })
  })

  test('a lone surrogate is made visible', () => {
    expect(toTerminalSafe('a\ud800b')).toEqual({ text: 'a<U+D800>b', escaped: 1 })
  })

  test('up to four stacked combining marks are kept; more are made visible', () => {
    const acute = String.fromCodePoint(0x0301)
    const strike = String.fromCodePoint(0x0336)
    expect(toTerminalSafe(`e${acute}${acute}${acute}${acute}`)).toEqual({ text: `e${acute.repeat(4)}`, escaped: 0 })
    expect(toTerminalSafe(`x${strike.repeat(6)}y`)).toEqual({
      text: `x${strike.repeat(4)}<U+0336><U+0336>y`,
      escaped: 2,
    })
  })

  test('emoji presentation selectors are kept', () => {
    const heart = String.fromCodePoint(0x2764, 0xfe0f)
    expect(toTerminalSafe(heart)).toEqual({ text: heart, escaped: 0 })
  })

  test('no code point survives as a control, format, separator, or default-ignorable character', () => {
    const allowed = new Set(['\n', '\t', String.fromCodePoint(0xfe0e), String.fromCodePoint(0xfe0f)])
    const hidden = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u
    const survivors: string[] = []
    for (let code = 0; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue
      for (const char of safeText(String.fromCodePoint(code))) {
        if (hidden.test(char) && !allowed.has(char)) survivors.push(code.toString(16))
      }
    }
    expect(survivors).toEqual([])
  })
})

describe('shellQuote', () => {
  test.each([
    ['cowsay', 'cowsay'],
    ['@agentfacets/cowsay', '@agentfacets/cowsay'],
    ['skills/x/references/a.md', 'skills/x/references/a.md'],
    ['notes;touch pwned.md', "'notes;touch pwned.md'"],
    ["it's.md", "'it'\\''s.md'"],
    ['$(id).md', "'$(id).md'"],
    ['a b', "'a b'"],
  ])('%s → %s', (input, expected) => {
    expect(shellQuote(input)).toBe(expected)
  })

  test('a quoted argument comes back as one literal word from a real shell', async () => {
    const hostile = "notes;touch pwned $(id) `id` it's.md"
    const child = Bun.spawn(['sh', '-c', `printf %s ${shellQuote(hostile)}`], { stdout: 'pipe' })
    expect(await new Response(child.stdout).text()).toBe(hostile)
  })
})
