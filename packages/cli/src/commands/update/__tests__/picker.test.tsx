import { describe, expect, test } from 'bun:test'
import type { FacetUpdateSelection } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { stripTerminalControls, visibleTerminalText } from '../../../__tests__/helpers/terminal-output.ts'
import { UpdatePicker } from '../picker.tsx'
import type { UpdateMode } from '../selection.ts'
import { candidate } from './fixtures.ts'

const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  enter: '\r',
  space: ' ',
  escape: '\u001B',
  ctrlC: '\u0003',
} as const

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

/**
 * Which column each row says it would install.
 *
 * Read from the visible text on purpose. Bold and underline carry the
 * same meaning on a capable terminal, but they vanish under `NO_COLOR`,
 * a pipe, or a screen reader — and this suite runs without colour
 * support, which is exactly the environment that proves the word is
 * load-bearing rather than decorative.
 */
function chosenLabels(frame: string): string[] {
  return [...visibleTerminalText(frame).matchAll(/\((target|latest)\)/g)].map((match) => match[1] ?? '')
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
})

const PINNED = candidate({
  name: 'beta',
  source: '1.2.0',
  current: '1.2.0',
  target: '1.2.0',
  latest: '3.0.0',
})

function mount(candidates: Parameters<typeof UpdatePicker>[0]['candidates'], mode: UpdateMode = 'range') {
  const state: { confirmed: readonly FacetUpdateSelection[] | null; aborted: boolean } = {
    confirmed: null,
    aborted: false,
  }
  const app = render(
    createElement(UpdatePicker, {
      candidates,
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
  test('renders every candidate it is handed', async () => {
    // Filtering happens before the mount — `candidateRows` owns it, and
    // the non-empty type is what makes the cursor arithmetic here safe.
    const { app } = mount([BOUNDED, PINNED])
    await nextTick()
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('alpha')
    expect(frame).toContain('beta')
    app.unmount()
  })

  test('every row shows current, target, and latest together', async () => {
    const { app } = mount([BOUNDED])
    await nextTick()
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    expect(frame).toContain('facet current target latest')
    // The comparison this screen exists for needs all three at once.
    expect(frame).toContain('alpha 1.2.0 1.8.0 2.0.0')
    app.unmount()
  })

  // The columns are the comparison, so they have to read as columns.
  // `visibleTerminalText` collapses exactly the whitespace that carries
  // this, so it is asserted against the raw frame.
  test('columns line up across rows of different name lengths', async () => {
    const { app } = mount([
      BOUNDED,
      candidate({ name: 'a-much-longer-name', source: '2.*', current: '2.0.0', target: '2.1.0', latest: '9.10.11' }),
    ])
    await nextTick()
    const lines = stripTerminalControls(app.lastFrame() ?? '')
      .split('\n')
      .filter((line) => line.includes('1.2.0') || line.includes('2.0.0') || line.includes('current'))
    expect(lines).toHaveLength(3)

    const header = lines[0] ?? ''
    for (const label of ['facet', 'current', 'target', 'latest']) {
      const at = header.indexOf(label)
      expect(at).toBeGreaterThanOrEqual(0)
      for (const row of lines.slice(1)) {
        expect({ label, char: row.charAt(at) }).toEqual({ label, char: row.charAt(at).trimEnd() })
      }
    }
    app.unmount()
  })

  // Quoted verbatim in `docs/cli/update.mdx`. Without an assertion, a
  // glyph or wording change here silently desynchronizes the docs.
  test('the legend names every key the screen responds to', async () => {
    const { app } = mount([BOUNDED])
    await nextTick()
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain(
      '↑↓ move · ◀ ▶ target/latest · Space select · Enter confirm · Esc cancel',
    )
    app.unmount()
  })

  test('plain mode starts on the range target', async () => {
    const { app, state } = mount([BOUNDED])
    await nextTick()
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain('1 of 1 selected')
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['target'])
    await press(app, KEY.enter)
    expect(state.confirmed).toEqual([{ facetName: 'alpha', choice: 'range' }])
    app.unmount()
  })

  test('latest mode starts on the latest release', async () => {
    const { app, state } = mount([BOUNDED], 'latest')
    await nextTick()
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['latest'])
    await press(app, KEY.enter)
    expect(state.confirmed).toEqual([{ facetName: 'alpha', choice: 'latest' }])
    app.unmount()
  })

  // The row `--latest` exists for: its range cannot move, so plain mode
  // shows it unselected with its target sitting on the installed version.
  test('a row whose displayed choice is already installed starts unselected', async () => {
    const { app } = mount([PINNED])
    await nextTick()
    const frame = visibleTerminalText(app.lastFrame() ?? '')
    // Target equal to current is legible from the columns themselves.
    expect(frame).toContain('beta 1.2.0 1.2.0 3.0.0')
    expect(frame).toContain('0 of 1 selected')
    app.unmount()
  })
})

describe('UpdatePicker — choosing', () => {
  test('l toggles the focused row between target and latest', async () => {
    const { app } = mount([BOUNDED])
    await nextTick()
    await press(app, 'l')
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['latest'])
    await press(app, 'l')
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['target'])
    app.unmount()
  })

  test('right moves to latest, left moves back to target', async () => {
    const { app } = mount([BOUNDED])
    await nextTick()
    await press(app, KEY.right)
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['latest'])
    await press(app, KEY.left)
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['target'])
    app.unmount()
  })

  // Clamping, not wrapping. Holding an arrow down should settle on a
  // column rather than oscillate between the two.
  test('the arrows clamp at each end instead of wrapping', async () => {
    const { app } = mount([BOUNDED])
    await nextTick()
    await press(app, KEY.left, KEY.left)
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['target'])
    await press(app, KEY.right, KEY.right, KEY.right)
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['latest'])
    app.unmount()
  })

  test('the arrows carry selection the same way l does', async () => {
    const { app, state } = mount([PINNED])
    await nextTick()
    // A stationary target cannot be selected; the advancing latest can.
    await press(app, KEY.right, KEY.space, KEY.enter)
    expect(state.confirmed).toEqual([{ facetName: 'beta', choice: 'latest' }])
    app.unmount()
  })

  test('arrows move columns while up and down still move rows', async () => {
    const { app, state } = mount([BOUNDED, PINNED])
    await nextTick()
    await press(app, KEY.down, KEY.right, KEY.space, KEY.enter)
    expect(state.confirmed).toEqual([
      { facetName: 'alpha', choice: 'range' },
      { facetName: 'beta', choice: 'latest' },
    ])
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
    expect(visibleTerminalText(app.lastFrame() ?? '')).toContain('0 of 1 selected')
    // Still shown as the row's choice, just not a selectable one.
    expect(chosenLabels(app.lastFrame() ?? '')).toEqual(['target'])
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
