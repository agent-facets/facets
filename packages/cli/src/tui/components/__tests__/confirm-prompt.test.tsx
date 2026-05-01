import { describe, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { ConfirmPrompt } from '../confirm-prompt.tsx'

const KEY_ENTER = '\r'
const KEY_ESC = '\u001b'
const CTRL_C = '\u0003'

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function afterEsc(): Promise<void> {
  // Ink needs a small grace period after a bare ESC byte to distinguish
  // it from the start of an escape sequence like \u001b[A (arrows).
  return new Promise((resolve) => setTimeout(resolve, 60))
}

describe('ConfirmPrompt — initial render', () => {
  test('renders the question and the (y/N) hint by default', () => {
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Overwrite existing file?',
        onAnswer: () => {},
      }),
    )
    const frame = instance.lastFrame()
    expect(frame).toContain('Overwrite existing file?')
    expect(frame).toContain('(y/N)')
    instance.unmount()
  })

  test('renders (Y/n) hint when defaultAnswer is true', () => {
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        defaultAnswer: true,
        onAnswer: () => {},
      }),
    )
    expect(instance.lastFrame()).toContain('(Y/n)')
    instance.unmount()
  })
})

describe('ConfirmPrompt — keypress', () => {
  test('y confirms', async () => {
    let answer: boolean | undefined
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        onAnswer: (a) => {
          answer = a
        },
      }),
    )
    instance.stdin.write('y')
    await nextTick()
    expect(answer).toBe(true)
    instance.unmount()
  })

  test('Y (capital) confirms', async () => {
    let answer: boolean | undefined
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        onAnswer: (a) => {
          answer = a
        },
      }),
    )
    instance.stdin.write('Y')
    await nextTick()
    expect(answer).toBe(true)
    instance.unmount()
  })

  test('n cancels', async () => {
    let answer: boolean | undefined
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        onAnswer: (a) => {
          answer = a
        },
      }),
    )
    instance.stdin.write('n')
    await nextTick()
    expect(answer).toBe(false)
    instance.unmount()
  })

  test('Enter uses defaultAnswer=false', async () => {
    let answer: boolean | undefined
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        onAnswer: (a) => {
          answer = a
        },
      }),
    )
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(answer).toBe(false)
    instance.unmount()
  })

  test('Enter uses defaultAnswer=true when set', async () => {
    let answer: boolean | undefined
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        defaultAnswer: true,
        onAnswer: (a) => {
          answer = a
        },
      }),
    )
    instance.stdin.write(KEY_ENTER)
    await nextTick()
    expect(answer).toBe(true)
    instance.unmount()
  })

  test('Esc cancels', async () => {
    let answer: boolean | undefined
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        onAnswer: (a) => {
          answer = a
        },
      }),
    )
    instance.stdin.write(KEY_ESC)
    await afterEsc()
    expect(answer).toBe(false)
    instance.unmount()
  })

  test('Ctrl-C cancels', async () => {
    let answer: boolean | undefined
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        onAnswer: (a) => {
          answer = a
        },
      }),
    )
    instance.stdin.write(CTRL_C)
    await nextTick()
    expect(answer).toBe(false)
    instance.unmount()
  })

  test('subsequent keystrokes after answer are ignored', async () => {
    let answerCallCount = 0
    const instance = render(
      createElement(ConfirmPrompt, {
        question: 'Continue?',
        onAnswer: () => {
          answerCallCount++
        },
      }),
    )
    instance.stdin.write('y')
    await nextTick()
    instance.stdin.write('n')
    await nextTick()
    instance.stdin.write('y')
    await nextTick()
    expect(answerCallCount).toBe(1)
    instance.unmount()
  })
})
