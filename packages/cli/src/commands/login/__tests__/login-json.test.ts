import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as engine from '@agent-facets/engine'
import * as ink from 'ink'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import { run } from '../../../run.ts'
import * as browser from '../../../util/open-browser.ts'

const { loginCommand } = await import('../index.ts')

const LOGIN_ID = '0123456789abcdef0123456789abcdef'
let restore: Array<() => void> = []
let calls: { durableBegin: number; durableComplete: string[]; picker: number; browser: number; humanBegin: number }

beforeEach(() => {
  calls = { durableBegin: 0, durableComplete: [], picker: 0, browser: 0, humanBegin: 0 }
  const spies = [
    spyOn(engine, 'beginDurableCliLogin').mockImplementation(async () => {
      calls.durableBegin++
      return {
        ok: true,
        value: {
          loginId: LOGIN_ID,
          registry: 'https://registry.example',
          display: {
            userCode: 'ABCD-EFGH',
            verificationUri: 'https://login.example/device',
            verificationUriComplete: 'https://login.example/device?user_code=ABCD-EFGH',
          },
          expiresAt: 2_000_000_000_000,
        },
      }
    }),
    spyOn(engine, 'completeDurableCliLogin').mockImplementation(async (id) => {
      calls.durableComplete.push(id)
      return { ok: false, error: { code: 'LOGIN_NOT_FOUND' } }
    }),
    spyOn(engine, 'beginCliLogin').mockImplementation(async () => {
      calls.humanBegin++
      return { ok: false, error: { code: 'CANCELLED' } }
    }),
    spyOn(engine, 'resolveCredential').mockImplementation(() => ({ source: 'absent' })),
    spyOn(ink, 'render').mockImplementation(() => {
      calls.picker++
      throw new Error('JSON login must not render')
    }),
    spyOn(browser, 'openBrowser').mockImplementation(async () => {
      calls.browser++
      return { ok: true }
    }),
  ]
  restore = spies.map((spy) => () => spy.mockRestore())
})

afterEach(() => {
  for (const undo of restore) undo()
})

async function invoke(argv: string[]): Promise<{ code: number; document: Record<string, unknown> }> {
  let output = ''
  const original = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString()
    return true
  }) as typeof process.stdout.write
  try {
    const code = await withTTY(true, () => run(['login', ...argv], { login: loginCommand }))
    return { code, document: JSON.parse(output) as Record<string, unknown> }
  } finally {
    process.stdout.write = original
  }
}

describe('facet login --json', () => {
  for (const argv of [['--json'], ['--no-browser', '--json']]) {
    test(`login ${argv.join(' ')} returns a pending challenge without a picker, browser, or polling`, async () => {
      const { code, document } = await invoke(argv)
      expect(code).toBe(0)
      expect(document).toMatchObject({
        command: 'login',
        ok: true,
        data: { status: 'authorization_pending', loginId: LOGIN_ID, userCode: 'ABCD-EFGH' },
      })
      expect(calls).toEqual({ durableBegin: 1, durableComplete: [], picker: 0, browser: 0, humanBegin: 0 })
    })
  }

  test('--complete resumes the given attempt', async () => {
    const { code, document } = await invoke(['--complete', LOGIN_ID, '--json'])
    expect(code).toBe(1)
    expect(document).toMatchObject({ ok: false, error: { code: 'LOGIN_NOT_FOUND' } })
    expect(calls.durableComplete).toEqual([LOGIN_ID])
    expect(calls.durableBegin).toBe(0)
  })

  for (const argv of [
    ['--browser', '--json'],
    ['--token', '--json'],
    ['--complete', LOGIN_ID, '--no-browser', '--json'],
    ['--complete', LOGIN_ID, '--complete', LOGIN_ID, '--json'],
    ['--complete', '--json'],
    ['--brwser', '--json'],
  ]) {
    test(`login ${argv.join(' ')} is refused before any auth call`, async () => {
      const { code, document } = await invoke(argv)
      expect(code).toBe(1)
      expect(document).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } })
      expect(calls).toEqual({ durableBegin: 0, durableComplete: [], picker: 0, browser: 0, humanBegin: 0 })
    })
  }
})

describe('facet login help', () => {
  test('lists both browser spellings and the completion placeholder', async () => {
    let output = ''
    const original = console.log
    console.log = (line: string) => {
      output += line
    }
    try {
      await run(['login', '--help'], { login: loginCommand })
    } finally {
      console.log = original
    }
    expect(output).toMatch(/^ {2}--browser\s+Skip the picker, open/m)
    expect(output).toMatch(/^ {2}--no-browser\s+Skip the picker and show/m)
    expect(output).toMatch(/^ {2}--complete <login-id>\s+Complete a pending login/m)
  })
})
