import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { visibleTerminalText } from '../../../__tests__/helpers/terminal-output.ts'
import { LoginMenu } from '../login-menu.tsx'

const KEY_ENTER = '\r'
const KEY_ESC = '\u001b'
const KEY_DOWN = '\u001b[B'
const KEY_CTRL_C = '\u0003'

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function afterEsc(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60))
}

describe('LoginMenu — method selection', () => {
  test('defaults to an enabled browser row and selects it once', async () => {
    let chosen = 0
    const instance = render(
      createElement(LoginMenu, {
        onChooseBrowser: () => {
          chosen++
        },
        onSubmitToken: () => {},
        onCancel: () => {},
      }),
    )
    const frame = visibleTerminalText(instance.lastFrame() ?? '')
    expect(frame).toContain('▸ ● Sign in via browser')
    expect(frame).toContain('Paste a personal access token')
    expect(frame).not.toContain('coming soon')
    instance.stdin.write(KEY_ENTER)
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(chosen).toBe(1)
    instance.unmount()
  })

  test('moves to the PAT option and masks the submitted token', async () => {
    const submitted: { token: string | null } = { token: null }
    const instance = render(
      createElement(LoginMenu, {
        onChooseBrowser: () => {},
        onSubmitToken: (token) => {
          submitted.token = token
        },
        onCancel: () => {},
      }),
    )
    instance.stdin.write(KEY_DOWN)
    await nextTick()
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('▸ ○ Paste a personal access token')
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    instance.stdin.write('fct_pub_canary')
    await nextTick()
    const frame = visibleTerminalText(instance.lastFrame() ?? '')
    expect(frame).toContain('Paste your personal access token')
    expect(frame).toContain('*')
    expect(frame).not.toContain('fct_pub_canary')
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(submitted.token).toBe('fct_pub_canary')
    instance.unmount()
  })

  test('Esc and Ctrl-C cancel the menu exactly once', async () => {
    for (const key of [KEY_ESC, KEY_CTRL_C]) {
      let cancelled = 0
      const instance = render(
        createElement(LoginMenu, {
          onChooseBrowser: () => {},
          onSubmitToken: () => {},
          onCancel: () => {
            cancelled++
          },
        }),
      )
      instance.stdin.write(key)
      instance.stdin.write(key)
      await afterEsc()
      expect(cancelled).toBe(1)
      instance.unmount()
    }
  })
})

describe('LoginMenu — token and polling phases', () => {
  test('token-only retry displays error and Esc cancels', async () => {
    let cancelled = 0
    const instance = render(
      createElement(LoginMenu, {
        initialError: 'invalid token — try again',
        tokenOnly: true,
        onSubmitToken: () => {},
        onCancel: () => {
          cancelled++
        },
      }),
    )
    const frame = visibleTerminalText(instance.lastFrame() ?? '')
    expect(frame).toContain('invalid token — try again')
    expect(frame).toContain('Paste your personal access token')
    instance.stdin.write(KEY_ESC)
    await afterEsc()
    expect(cancelled).toBe(1)
    instance.unmount()
  })

  test('polling view displays cancellation guidance and Esc aborts', async () => {
    let cancelled = 0
    const instance = render(
      createElement(LoginMenu, {
        polling: true,
        onSubmitToken: () => {},
        onCancel: () => {
          cancelled++
        },
      }),
    )
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('Waiting for browser sign-in')
    expect(visibleTerminalText(instance.lastFrame() ?? '')).toContain('Esc or Ctrl-C cancel')
    instance.stdin.write(KEY_ESC)
    await afterEsc()
    expect(cancelled).toBe(1)
    instance.unmount()
  })
})
