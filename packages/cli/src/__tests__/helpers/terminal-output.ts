/**
 * Test helpers for asserting on rendered terminal output.
 *
 * Rendered output is not the text a reader sees. Ink colours each `<Text>`
 * span, and `wrap-ansi` re-opens the active style after every line wrap, so
 * a single rendered sentence carries control sequences *between its words*:
 *
 *   "They are no \x1b[39m\n\x1b[38;2;253;224;71mlonger tracked"
 *
 * `toContain('no longer tracked')` is then false against output that renders
 * that phrase perfectly. Worse, the same bytes make `not.toContain(...)` and
 * `not.toMatch(/a\s+b/)` pass vacuously — a test that reports green while
 * asserting nothing. Whether any of this happens depends on whether the
 * runner is attached to a TTY, so a suite can be green in CI and red locally.
 *
 * These helpers put every assertion on the *visible* text instead:
 *
 *   `stripTerminalControls` — controls removed, line structure preserved.
 *     Use when the assertion is about layout: a regex spanning a row, or a
 *     negative assertion that must not match across two rows.
 *   `visibleTerminalText`   — controls removed, then wrapping whitespace
 *     collapsed. Use for prose, which wraps at whatever column the terminal
 *     happens to be. Stripping must happen first: collapsing leaves the
 *     control bytes sitting between the words it just joined.
 *   `contentFrame` / `visibleContentFrame` — the same two levels, applied to
 *     the last frame Ink rendered with anything in it.
 *
 * Raw bytes stay reachable: read `instance.lastFrame()` or `instance.frames`
 * directly. Do that only when the escape sequences are the subject — the
 * colour-contract tests in `tui/views/install/__tests__/collision-status.ts`
 * and `util/__tests__/errors.test.ts` assert on presentation data and exact
 * bytes on purpose, and normalizing them would delete what they check.
 */

import { stripVTControlCharacters } from 'node:util'

/**
 * Remove terminal control sequences (colour, cursor movement, hyperlinks),
 * leaving line structure intact.
 *
 * Node's own implementation, so the CLI's tests and Node agree on what a
 * control sequence is — a hand-rolled regex tends to miss OSC-8 hyperlinks
 * and other non-SGR sequences.
 */
export function stripTerminalControls(text: string): string {
  return stripVTControlCharacters(text)
}

/**
 * The visible text of rendered output: control sequences removed, then every
 * run of whitespace collapsed to a single space.
 *
 * Collapsing folds the terminal's line wrapping away, so an assertion can
 * name a phrase without also encoding the column it happened to break at.
 */
export function visibleTerminalText(text: string): string {
  return stripTerminalControls(text).replace(/\s+/g, ' ').trim()
}

/**
 * The last frame that rendered anything, with control sequences removed.
 *
 * Ink's final frame after an auto-unmount is blank, and a frame holding only
 * colour codes is blank to a reader, so both are skipped. Throws when no
 * frame had content: a missing frame must fail the test rather than quietly
 * satisfy every assertion against `''`.
 */
export function contentFrame(frames: ReadonlyArray<string | undefined>): string {
  for (let i = frames.length - 1; i >= 0; i--) {
    const visible = stripTerminalControls(frames[i] ?? '')
    if (visible.trim().length > 0) return visible
  }
  throw new Error(`no content frame found among ${frames.length} captured frames`)
}

/** {@link contentFrame}, with the terminal's wrapping collapsed away. */
export function visibleContentFrame(frames: ReadonlyArray<string | undefined>): string {
  return visibleTerminalText(contentFrame(frames))
}
