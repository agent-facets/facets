import { describe, expect, test } from 'bun:test'
import { canRenderLiveOutput, isInteractive, type TerminalCapabilities } from '../interactive.ts'

const FULLY_INTERACTIVE: TerminalCapabilities = {
  stdinIsTTY: true,
  stdoutIsTTY: true,
  rawModeSupported: true,
  ci: false,
}

describe('isInteractive', () => {
  test('a real terminal with a human at it can be prompted', () => {
    expect(isInteractive(FULLY_INTERACTIVE)).toBe(true)
  })

  test('a piped stdin is not interactive even when stdout is a terminal', () => {
    // `facet add < /dev/null` from a terminal. The old stdout-only check
    // passed this and then crashed inside Ink's setRawMode.
    expect(isInteractive({ ...FULLY_INTERACTIVE, stdinIsTTY: false })).toBe(false)
  })

  test('a redirected stdout is not interactive even when stdin is a terminal', () => {
    // `facet add > log.txt` — there is nowhere to draw the workspace.
    expect(isInteractive({ ...FULLY_INTERACTIVE, stdoutIsTTY: false })).toBe(false)
  })

  test('a stdin without raw-mode support is not interactive', () => {
    expect(isInteractive({ ...FULLY_INTERACTIVE, rawModeSupported: false })).toBe(false)
  })

  test('CI is never interactive, even with a pseudo-terminal on both streams', () => {
    // Runners commonly allocate a PTY with nobody attached. Prompting
    // there does not fail — it hangs until the job times out.
    expect(isInteractive({ ...FULLY_INTERACTIVE, ci: true })).toBe(false)
  })
})

describe('canRenderLiveOutput', () => {
  test('a terminal stdout can host a repainting region', () => {
    expect(canRenderLiveOutput(FULLY_INTERACTIVE)).toBe(true)
  })

  // A progress indicator reads no keys, so stdin's shape is none of its
  // business. `facet update < /dev/null` in a terminal still gets one.
  test('stdin has no say in it', () => {
    expect(canRenderLiveOutput({ ...FULLY_INTERACTIVE, stdinIsTTY: false, rawModeSupported: false })).toBe(true)
  })

  test('a redirected stdout has nowhere to repaint', () => {
    expect(canRenderLiveOutput({ ...FULLY_INTERACTIVE, stdoutIsTTY: false })).toBe(false)
  })

  // The case that made this predicate necessary. A CI runner with a
  // pseudo-terminal passes an `isTTY` test while Ink independently
  // decides the mount is non-interactive — its `clear()` then does
  // nothing and its `unmount()` flushes the last frame into stdout, in
  // front of output the caller was parsing.
  test('CI never gets frames, pseudo-terminal or not', () => {
    expect(canRenderLiveOutput({ ...FULLY_INTERACTIVE, ci: true })).toBe(false)
  })

  test('it is exactly the pair of facts Ink itself uses', () => {
    // Anything interactive can certainly host live output; the converse
    // does not hold, which is why these are two predicates.
    expect(canRenderLiveOutput(FULLY_INTERACTIVE)).toBe(isInteractive(FULLY_INTERACTIVE))
    expect(canRenderLiveOutput({ ...FULLY_INTERACTIVE, ci: true })).toBe(false)
  })
})
