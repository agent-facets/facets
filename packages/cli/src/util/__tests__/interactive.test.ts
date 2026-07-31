import { describe, expect, test } from 'bun:test'
import { isInteractive, type TerminalCapabilities } from '../interactive.ts'

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
