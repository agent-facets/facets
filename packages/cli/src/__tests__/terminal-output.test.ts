import { describe, expect, test } from 'bun:test'
import {
  contentFrame,
  stripTerminalControls,
  visibleContentFrame,
  visibleTerminalText,
} from './helpers/terminal-output.ts'

/** Turn on a 24-bit foreground colour, the shape Ink's theme emits. */
const YELLOW = '\u001B[38;2;253;224;71m'
/** Return the foreground to its default. */
const RESET = '\u001B[39m'

describe('stripTerminalControls', () => {
  test('removes colour sequences that sit between two words', () => {
    expect(stripTerminalControls(`no ${RESET}${YELLOW}longer tracked`)).toBe('no longer tracked')
  })

  test('removes a hyperlink sequence, keeping its visible label', () => {
    // Not an SGR sequence — the reason this delegates to Node rather than
    // matching \u001B[...m by hand.
    const linked = `\u001B]8;;https://agentfacets.io\u0007docs\u001B]8;;\u0007`
    expect(stripTerminalControls(linked)).toBe('docs')
  })

  test('preserves line structure, so layout assertions stay possible', () => {
    // A regex spanning one row, or a negative assertion that must not match
    // across two rows, needs the rows to still be rows.
    const frame = `${YELLOW}claude-code${RESET} (installed)\n${YELLOW}opencode${RESET}`
    const stripped = stripTerminalControls(frame)

    expect(stripped.split('\n')).toEqual(['claude-code (installed)', 'opencode'])
    expect(stripped).toMatch(/claude-code.*\(installed\)/)
    expect(stripped).not.toMatch(/opencode.*\(installed\)/)
  })

  test('leaves control-free text untouched', () => {
    expect(stripTerminalControls('plain text\n  indented')).toBe('plain text\n  indented')
  })
})

describe('visibleTerminalText', () => {
  test('joins a phrase Ink wrapped and recoloured mid-sentence', () => {
    // The rendered shape that made `toContain('no longer tracked')` fail
    // against output that displayed exactly that: a wrap, and the active
    // colour re-opened on the next row.
    const wrapped = `They are no ${RESET}\n${YELLOW}longer tracked — remove whatever remains manually.`

    expect(visibleTerminalText(wrapped)).toContain('no longer tracked')
  })

  test('strips before collapsing, so no control bytes survive between words', () => {
    // Collapsing first would leave "no \u001B[39m \u001B[38;2;…mlonger" —
    // whitespace-normalized, still unassertable.
    const wrapped = `no ${RESET}\n${YELLOW}longer`
    const collapsedFirst = wrapped.replace(/\s+/g, ' ')

    expect(collapsedFirst).not.toContain('no longer')
    expect(visibleTerminalText(wrapped)).toBe('no longer')
  })

  test('collapses every run of whitespace, including indentation and blank lines', () => {
    expect(visibleTerminalText('  ⚠ skill “review”\n\n    was  missing  ')).toBe('⚠ skill “review” was missing')
  })

  test('a phrase already on one line is unaffected', () => {
    expect(visibleTerminalText(`${YELLOW}1 installed · 1 asset written${RESET}`)).toBe('1 installed · 1 asset written')
  })
})

describe('contentFrame', () => {
  test('returns the last frame that rendered anything', () => {
    expect(contentFrame(['first', 'second'])).toBe('second')
  })

  test('skips the blank frame Ink leaves behind after unmounting', () => {
    expect(contentFrame(['Install complete.', '\n'])).toBe('Install complete.')
  })

  test('skips a frame carrying only colour codes, which shows a reader nothing', () => {
    expect(contentFrame(['Install complete.', `${YELLOW}${RESET}`])).toBe('Install complete.')
  })

  test('skips undefined entries', () => {
    expect(contentFrame(['Install complete.', undefined])).toBe('Install complete.')
  })

  test('strips control sequences from the frame it returns', () => {
    expect(contentFrame([`${YELLOW}1 installed${RESET}`])).toBe('1 installed')
  })

  test('throws when no frame had content, rather than returning an empty string', () => {
    // An empty string satisfies every `not.toContain` assertion in the file.
    expect(() => contentFrame(['', '\n', undefined])).toThrow('no content frame found')
  })

  test('does not mutate the frames it was given', () => {
    const raw = `${YELLOW}1 installed${RESET}`
    const frames = [raw]

    contentFrame(frames)

    // Raw bytes stay reachable for the tests whose subject is the colour.
    expect(frames).toEqual([raw])
    expect(frames[0]).toContain(YELLOW)
  })
})

describe('visibleContentFrame', () => {
  test('applies both levels to the last frame with content', () => {
    const frames = [
      'Removing facets:',
      `${YELLOW}⚠ its recorded files were left untouched. They are no ${RESET}\n${YELLOW}longer tracked.${RESET}`,
      '\n',
    ]

    expect(visibleContentFrame(frames)).toBe('⚠ its recorded files were left untouched. They are no longer tracked.')
  })

  test('throws when no frame had content', () => {
    expect(() => visibleContentFrame([])).toThrow('no content frame found')
  })
})
