/**
 * Facet text is written by its publisher. Shown raw, it could move the
 * cursor, hide text from the person reviewing it, forge hyperlinks, or
 * reorder what a line appears to say — while an agent reading the same
 * bytes sees something else. Everything a facet supplies goes through
 * `toTerminalSafe` before it reaches a terminal.
 *
 * Conventions follow GNU `ls` (escape on a terminal, raw on a pipe) and
 * `less` (caret notation).
 */

/**
 * Every character a terminal may draw as nothing, or that acts on the text
 * around it instead of drawing: controls, format characters (bidi controls,
 * zero-width characters, Unicode tag characters), line and paragraph
 * separators, default-ignorable code points (variation selectors,
 * fillers), and lone surrogates from malformed JSON escapes. Matched by
 * Unicode property, not by a list, so characters the standard assigns
 * later are covered without a code change.
 */
const HIDDEN = /^[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]$/u

/** Draws as a blank cell but is classed as a symbol, so no property above covers it. */
const BRAILLE_BLANK = 0x2800

const MARK = /^[\p{Mn}\p{Me}]$/u

/**
 * Real text stacks a few combining marks on one base character; long runs
 * ("Zalgo" text) draw over the lines above and below and can obscure them.
 */
const MAX_STACKED_MARKS = 4

/** Text and emoji presentation selectors: they follow most emoji and hide nothing. */
const PRESENTATION_SELECTORS = new Set([0xfe0e, 0xfe0f])

/** Make control, format, invisible, and over-stacked characters visible. Line feeds, tabs, and CRLF endings are kept. */
export function toTerminalSafe(text: string): { text: string; escaped: number } {
  let out = ''
  let escaped = 0
  let marks = 0
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? ''
    const code = char.codePointAt(0) ?? 0
    marks = MARK.test(char) ? marks + 1 : 0
    if (char === '\n' || char === '\t') {
      out += char
    } else if (char === '\r' && chars[i + 1] === '\n') {
      out += char
    } else if (code < 0x20) {
      out += `^${String.fromCharCode(code + 0x40)}`
      escaped++
    } else if (code === 0x7f) {
      out += '^?'
      escaped++
    } else if (
      (HIDDEN.test(char) && !PRESENTATION_SELECTORS.has(code)) ||
      code === BRAILLE_BLANK ||
      marks > MAX_STACKED_MARKS
    ) {
      out += `<U+${code.toString(16).toUpperCase().padStart(4, '0')}>`
      escaped++
    } else {
      out += char
    }
  }
  return { text: out, escaped }
}

/** `toTerminalSafe`, keeping only the text. */
export function safeText(text: string): string {
  return toTerminalSafe(text).text
}

const SHELL_SAFE = /^[A-Za-z0-9@%_+=:,./-]+$/

/** Quote one argument so a POSIX shell passes it through as a single literal word. */
export function shellQuote(arg: string): string {
  if (SHELL_SAFE.test(arg)) return arg
  return `'${arg.replaceAll("'", "'\\''")}'`
}
