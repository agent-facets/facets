import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { InstallPicker } from '../install-picker.tsx'

const KEY_DOWN = '\u001b[B'
const KEY_UP = '\u001b[A'
const KEY_SPACE = ' '
const KEY_ENTER = '\r'
const KEY_ESC = '\u001b'

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// Ink needs a small grace period after a bare ESC byte to distinguish it
// from the start of an escape sequence like \u001b[A (arrow keys).
function afterEsc(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60))
}

describe('InstallPicker — initial render', () => {
  test('shows the zero-adapter header when nothing is installed', () => {
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: () => {},
        onAbort: () => {},
      }),
    )
    expect(instance.lastFrame()).toContain('No AI tools are connected yet. Pick which adapter to install.')
    instance.unmount()
  })

  test('switches header to "install or update" when at least one adapter is already installed', () => {
    const instance = render(
      createElement(InstallPicker, {
        installedNames: ['claude-code'],
        onConfirm: () => {},
        onAbort: () => {},
      }),
    )
    const frame = instance.lastFrame() ?? ''
    expect(frame).toContain('Pick which adapter to install or update.')
    expect(frame).not.toContain('No AI tools are connected yet')
    instance.unmount()
  })

  test('annotates already-installed rows with "installed — select to update"', () => {
    const instance = render(
      createElement(InstallPicker, {
        installedNames: ['claude-code'],
        onConfirm: () => {},
        onAbort: () => {},
      }),
    )
    const frame = instance.lastFrame() ?? ''
    // claude-code marked as installed
    expect(frame).toMatch(/claude-code.*\(installed — select to update\)/)
    // opencode (not installed) stays un-annotated
    expect(frame).not.toMatch(/opencode.*\(installed/)
    instance.unmount()
  })

  test('lists all first-party adapters', () => {
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: () => {},
        onAbort: () => {},
      }),
    )
    const frame = instance.lastFrame() ?? ''
    expect(frame).toContain('claude-code')
    expect(frame).toContain('opencode')
    expect(frame).toContain('codex')
    expect(frame).toContain('openclaw')
    instance.unmount()
  })

  test('keyboard hint row is present', () => {
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: () => {},
        onAbort: () => {},
      }),
    )
    expect(instance.lastFrame()).toContain('↑↓ move · Space toggle · Enter confirm · Esc cancel')
    instance.unmount()
  })
})

describe('InstallPicker — keyboard interaction', () => {
  test('Ctrl-C aborts and calls onAbort', async () => {
    let aborted = false
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: () => {},
        onAbort: () => {
          aborted = true
        },
      }),
    )
    instance.stdin.write('\u0003') // Ctrl-C
    await nextTick()
    expect(aborted).toBe(true)
    instance.unmount()
  })

  test('Esc aborts and calls onAbort', async () => {
    let aborted = false
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: () => {},
        onAbort: () => {
          aborted = true
        },
      }),
    )
    instance.stdin.write(KEY_ESC)
    await afterEsc()
    expect(aborted).toBe(true)
    instance.unmount()
  })

  test('Enter with no selection shows the soft-abort hint and stays mounted', async () => {
    let confirmed = false
    let aborted = false
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: () => {
          confirmed = true
        },
        onAbort: () => {
          aborted = true
        },
      }),
    )
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(confirmed).toBe(false)
    expect(aborted).toBe(false)
    expect(instance.lastFrame()).toContain('Select at least one with Space.')
    instance.unmount()
  })

  test('Space toggles selection on a selectable row, then Enter confirms', async () => {
    const state: { confirmed: { name: string }[] | null } = { confirmed: null }
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: (selected) => {
          state.confirmed = selected.map((s) => ({ name: s.name }))
        },
        onAbort: () => {},
      }),
    )
    instance.stdin.write(KEY_SPACE)
    await nextTick()
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(state.confirmed).toEqual([{ name: 'claude-code' }])
    instance.unmount()
  })

  test('Cursor able to select multiple adapter rows', async () => {
    // All first-party adapters are selectable:
    // claude-code → opencode → codex → openclaw → wrap back to claude-code.
    const state: { confirmed: { name: string }[] | null } = { confirmed: null }
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: (selected) => {
          state.confirmed = selected.map((s) => ({ name: s.name }))
        },
        onAbort: () => {},
      }),
    )
    instance.stdin.write(KEY_DOWN) // claude-code → opencode
    await nextTick()
    instance.stdin.write(KEY_DOWN) // opencode → codex (no longer skipped)
    await nextTick()
    instance.stdin.write(KEY_SPACE) // select codex
    await nextTick()
    instance.stdin.write(KEY_DOWN) // codex → openclaw
    await nextTick()
    instance.stdin.write(KEY_DOWN) // openclaw → wrap back to claude-code
    await nextTick()
    instance.stdin.write(KEY_SPACE) // select claude-code
    await nextTick()
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    // Confirmed selection is returned in catalog order (claude-code, then codex).
    expect(state.confirmed).toEqual([{ name: 'claude-code' }, { name: 'codex' }])
    instance.unmount()
  })

  test('Space on the dimmed codex row is a no-op', async () => {
    // Override options so the cursor starts on the dimmed row directly.
    const optionsDimmedFirst = [
      { name: 'codex', npmPackage: '@agent-facets/adapter-codex', supportsInstall: false },
      { name: 'opencode', npmPackage: '@agent-facets/adapter-opencode', supportsInstall: true },
    ]
    let confirmed = false
    const instance = render(
      createElement(InstallPicker, {
        options: optionsDimmedFirst,
        onConfirm: () => {
          confirmed = true
        },
        onAbort: () => {},
      }),
    )
    // Cursor starts on first selectable (opencode, index 1). Move up to wrap
    // around — it should still land on opencode (the only selectable).
    instance.stdin.write(KEY_UP)
    await nextTick()
    instance.stdin.write(KEY_SPACE)
    await nextTick()
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(confirmed).toBe(true)
    instance.unmount()
  })

  test('soft-abort hint is cleared after the next keypress', async () => {
    const instance = render(
      createElement(InstallPicker, {
        onConfirm: () => {},
        onAbort: () => {},
      }),
    )
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(instance.lastFrame()).toContain('Select at least one with Space.')
    instance.stdin.write(KEY_DOWN)
    await nextTick()
    expect(instance.lastFrame()).not.toContain('Select at least one with Space.')
    instance.unmount()
  })
})
