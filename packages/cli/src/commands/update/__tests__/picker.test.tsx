import { describe, expect, test } from 'bun:test'
import type { FacetUpdateSelection } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { visibleTerminalText } from '../../../__tests__/helpers/terminal-output.ts'
import { UpdatePicker } from '../picker.tsx'
import type { UpdateMode } from '../selection.ts'
import { candidate, current } from './fixtures.ts'

const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  enter: '\r',
  space: ' ',
  escape: '\u001B',
  ctrlC: '\u0003',
} as const

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

// Ink needs a grace period after a bare ESC byte to tell it apart from
// the start of an escape sequence like the arrow keys.
function afterEsc(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60))
}

const BOUNDED = candidate({
  name: 'alpha',
  source: '1.*',
  current: '1.2.0',
  target: '1.8.0',
  latest: '2.0.0',
  advancing: 'range-and-latest',
})

const PINNED = candidate({
  name: 'beta',
  source: '1.2.0',
  current: '1.2.0',
  target: '1.2.0',
  latest: '3.0.0',
  advancing: 'latest-only',
})

function mount(plan: Parameters<typeof UpdatePicker>[0]['plan'], mode: UpdateMode = 'range') {
  const state: { confirmed: FacetUpdateSelection[] | null; aborted: boolean } = { confirmed: null, aborted: false }
  const app = render(
    createElement(UpdatePicker, {
      plan,
      mode,
      onConfirm: (selections) => {
        state.confirmed = selections
      },
      onAbort: () => {
        state.aborted = true
      },
    }),
  )
  return { app, state }
}

async function press(app: ReturnType<typeof render>, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    app.stdin.write(key)
    await nextTick()
  }
}

describe('UpdatePicker — what it offers', () => {
  test('shows only candidates, with both versions on every row', async () => {
    const { app } = mount([BOUNDED, PINNED, current({ name: 'gamma', source: '*', version: '4.0.0' })])
    await nextTick()
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('alpha')
    expect(frame).toContain('beta')
    // A facet with nothing newer has no decision to offer.
    expect(frame).not.toContain('gamma')
    app.unmount()
  })

  test('plain mode starts on the range target', async () => {
    const { app } = mount([BOUNDED])
    await nextTick()
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('1.2.0 → 1.8.0')
    expect(frame).toContain('(target)')
    expect(frame).toContain('1 of 1 selected')
    app.unmount()
  })

  test('latest mode starts on the latest release', async () => {
    const { app } = mount([BOUNDED], 'latest')
    await nextTick()
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('1.2.0 → 2.0.0')
    expect(frame).toContain('(latest)')
    app.unmount()
  })

  // The row `--latest` exists for: its range cannot move, so plain mode
  // shows it unselected and says why.
  test('a row whose displayed choice is already installed starts unselected', async () => {
    const { app } = mount([PINNED])
    await nextTick()
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('unchanged')
    expect(frame).toContain('0 of 1 selected')
    app.unmount()
  })
})

describe('UpdatePicker — choosing', () => {
  test('l toggles the focused row between target and latest', async () => {
    const { app } = mount([BOUNDED])
    await nextTick()
    await press(app, 'l')
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain('1.2.0 → 2.0.0')
    await press(app, 'l')
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain('1.2.0 → 1.8.0')
    app.unmount()
  })

  test('space deselects and reselects a row', async () => {
    const { app, state } = mount([BOUNDED])
    await nextTick()
    await press(app, KEY.space)
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain('0 of 1 selected')
    await press(app, KEY.space, KEY.enter)
    expect(state.confirmed).toEqual([{ facetName: 'alpha', choice: 'range' }])
    app.unmount()
  })

  test('a non-advancing choice cannot be selected, and says what to press', async () => {
    const { app, state } = mount([PINNED])
    await nextTick()
    await press(app, KEY.space)
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('already installed')
    expect(frame).toContain('0 of 1 selected')
    // Enter is refused too — there is nothing selected to confirm.
    await press(app, KEY.enter)
    expect(state.confirmed).toBeNull()
    app.unmount()
  })

  test('toggling to the advancing choice makes the same row selectable', async () => {
    const { app, state } = mount([PINNED])
    await nextTick()
    await press(app, 'l', KEY.space, KEY.enter)
    expect(state.confirmed).toEqual([{ facetName: 'beta', choice: 'latest' }])
    app.unmount()
  })

  // Selection is not carried across a toggle onto a version that would
  // change nothing: the state that says "selected" cannot hold it.
  test('toggling a selected row onto a stationary choice deselects it', async () => {
    const { app } = mount([PINNED], 'latest')
    await nextTick()
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain('1 of 1 selected')
    await press(app, 'l')
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('0 of 1 selected')
    expect(frame).toContain('unchanged')
    app.unmount()
  })

  test('arrows move the focus between rows', async () => {
    const { app, state } = mount([BOUNDED, PINNED])
    await nextTick()
    // Move to beta, toggle it to latest, select it, and confirm both.
    await press(app, KEY.down, 'l', KEY.space, KEY.enter)
    expect(state.confirmed).toEqual([
      { facetName: 'alpha', choice: 'range' },
      { facetName: 'beta', choice: 'latest' },
    ])
    app.unmount()
  })

  test('the focus wraps at both ends', async () => {
    const { app, state } = mount([BOUNDED, PINNED])
    await nextTick()
    // Up from the first row lands on the last one.
    await press(app, KEY.up, 'l', KEY.space, KEY.enter)
    expect(state.confirmed).toContainEqual({ facetName: 'beta', choice: 'latest' })
    app.unmount()
  })
})

describe('UpdatePicker — leaving without applying', () => {
  test('confirming nothing is refused with a hint', async () => {
    const { app, state } = mount([BOUNDED])
    await nextTick()
    await press(app, KEY.space, KEY.enter)
    expect(state.confirmed).toBeNull()
    expect(state.aborted).toBe(false)
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain('Select at least one facet')
    app.unmount()
  })

  test('escape cancels', async () => {
    const { app, state } = mount([BOUNDED])
    await nextTick()
    app.stdin.write(KEY.escape)
    await afterEsc()
    expect(state.aborted).toBe(true)
    expect(state.confirmed).toBeNull()
    app.unmount()
  })

  test('ctrl-c cancels', async () => {
    const { app, state } = mount([BOUNDED])
    await nextTick()
    await press(app, KEY.ctrlC)
    expect(state.aborted).toBe(true)
    expect(state.confirmed).toBeNull()
    app.unmount()
  })
})
