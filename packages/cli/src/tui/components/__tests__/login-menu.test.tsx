import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { LoginMenu } from '../login-menu.tsx'

const KEY_ENTER = '\r'
const KEY_ESC = '\u001b'

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function afterEsc(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60))
}

describe('LoginMenu — menu phase', () => {
  test('shows both options with the browser option marked coming soon', () => {
    const instance = render(createElement(LoginMenu, { onSubmitToken: () => {}, onCancel: () => {} }))
    const frame = instance.lastFrame() ?? ''
    expect(frame).toContain('Paste a personal access token')
    expect(frame).toContain('Sign in via browser')
    expect(frame).toContain('coming soon')
    instance.unmount()
  })

  test('Esc at the menu cancels', async () => {
    let cancelled = false
    const instance = render(
      createElement(LoginMenu, {
        onSubmitToken: () => {},
        onCancel: () => {
          cancelled = true
        },
      }),
    )
    instance.stdin.write(KEY_ESC)
    await afterEsc()
    expect(cancelled).toBe(true)
    instance.unmount()
  })
})

describe('LoginMenu — token phase', () => {
  test('Enter advances to the masked token prompt', async () => {
    const instance = render(createElement(LoginMenu, { onSubmitToken: () => {}, onCancel: () => {} }))
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(instance.lastFrame()).toContain('Paste your personal access token')
    instance.unmount()
  })

  test('masks typed characters and submits the trimmed token', async () => {
    const captured: { token: string | null } = { token: null }
    const instance = render(
      createElement(LoginMenu, {
        onSubmitToken: (t: string) => {
          captured.token = t
        },
        onCancel: () => {},
      }),
    )
    instance.stdin.write(KEY_ENTER) // menu → token phase
    await nextTick()
    instance.stdin.write('fct_pub_abc')
    await nextTick()
    const frame = instance.lastFrame() ?? ''
    // The raw token must not appear; masked asterisks render instead.
    expect(frame).not.toContain('fct_pub_abc')
    expect(frame).toContain('*')
    instance.stdin.write(KEY_ENTER) // submit
    await nextTick()
    expect(captured.token).toBe('fct_pub_abc')
    instance.unmount()
  })

  test('starts directly at the token prompt and shows the error when initialError is set', () => {
    const instance = render(
      createElement(LoginMenu, {
        initialError: 'invalid token — try again',
        onSubmitToken: () => {},
        onCancel: () => {},
      }),
    )
    const frame = instance.lastFrame() ?? ''
    expect(frame).toContain('invalid token — try again')
    expect(frame).toContain('Paste your personal access token')
    instance.unmount()
  })
})
