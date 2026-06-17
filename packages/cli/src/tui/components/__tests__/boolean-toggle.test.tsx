import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { FocusOrderProvider } from '../../context/focus-order-context.ts'
import { BooleanToggle } from '../boolean-toggle.tsx'

const KEY_ENTER = '\r'
const KEY_SPACE = ' '
const KEY_TAB = '\t'
const KEY_RIGHT = '\u001b[C'
const KEY_LEFT = '\u001b[D'

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function renderToggle(props: {
  value: boolean
  onToggle?: (next: boolean) => void
  onConfirm?: () => void
  focused?: boolean
}) {
  return render(
    <FocusOrderProvider initialFocusId={props.focused === false ? null : 'field-private'}>
      <BooleanToggle
        id="field-private"
        label="Privacy"
        value={props.value}
        onLabel="Private"
        offLabel="Public"
        onToggle={props.onToggle ?? (() => {})}
        onConfirm={props.onConfirm}
      />
    </FocusOrderProvider>,
  )
}

describe('BooleanToggle — rendering', () => {
  test('shows Public when value is false', () => {
    const instance = renderToggle({ value: false })
    expect(instance.lastFrame()).toContain('Public')
    instance.unmount()
  })

  test('shows Private when value is true', () => {
    const instance = renderToggle({ value: true })
    expect(instance.lastFrame()).toContain('Private')
    instance.unmount()
  })

  test('shows key hints only when focused', () => {
    const focused = renderToggle({ value: false, focused: true })
    expect(focused.lastFrame()).toContain('to toggle')
    focused.unmount()

    const blurred = renderToggle({ value: false, focused: false })
    expect(blurred.lastFrame()).not.toContain('to toggle')
    blurred.unmount()
  })
})

describe('BooleanToggle — keyboard', () => {
  test('Space toggles the value', async () => {
    let next: boolean | undefined
    const instance = renderToggle({
      value: false,
      onToggle: (v) => {
        next = v
      },
    })
    instance.stdin.write(KEY_SPACE)
    await nextTick()
    expect(next).toBe(true)
    instance.unmount()
  })

  test('Right arrow toggles the value', async () => {
    let next: boolean | undefined
    const instance = renderToggle({
      value: false,
      onToggle: (v) => {
        next = v
      },
    })
    instance.stdin.write(KEY_RIGHT)
    await nextTick()
    expect(next).toBe(true)
    instance.unmount()
  })

  test('Left arrow toggles the value', async () => {
    let next: boolean | undefined
    const instance = renderToggle({
      value: true,
      onToggle: (v) => {
        next = v
      },
    })
    instance.stdin.write(KEY_LEFT)
    await nextTick()
    expect(next).toBe(false)
    instance.unmount()
  })

  test('Tab toggles the value', async () => {
    let next: boolean | undefined
    const instance = renderToggle({
      value: false,
      onToggle: (v) => {
        next = v
      },
    })
    instance.stdin.write(KEY_TAB)
    await nextTick()
    expect(next).toBe(true)
    instance.unmount()
  })

  test('Enter advances via onConfirm and does not toggle', async () => {
    let confirmed = false
    let toggled = false
    const instance = renderToggle({
      value: false,
      onToggle: () => {
        toggled = true
      },
      onConfirm: () => {
        confirmed = true
      },
    })
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(confirmed).toBe(true)
    expect(toggled).toBe(false)
    instance.unmount()
  })

  test('ignores input when not focused', async () => {
    let toggled = false
    const instance = renderToggle({
      value: false,
      focused: false,
      onToggle: () => {
        toggled = true
      },
    })
    instance.stdin.write(KEY_SPACE)
    await nextTick()
    expect(toggled).toBe(false)
    instance.unmount()
  })
})
