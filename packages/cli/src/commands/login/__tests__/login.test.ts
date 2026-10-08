import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as engine from '@agent-facets/engine'
import * as ink from 'ink'
import { isValidElement } from 'react'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import type { OpenBrowserResult } from '../../../util/open-browser.ts'

const canary = 'device-secret-canary-must-not-print'
const attempt = {
  display: {
    verificationUri: 'https://login.example/device',
    verificationUriComplete: 'https://login.example/device?user_code=ABCD-1234',
    userCode: 'ABCD-1234',
  },
  expiresAt: 9999999999999,
  hiddenDeviceCode: canary,
}

let beginResult:
  | { ok: true; value: typeof attempt }
  | { ok: false; error: { code: 'CONFIG_UNAVAILABLE'; reason: 'NETWORK_ERROR' } }
let completeBehavior: (signal?: AbortSignal) => Promise<unknown>
let legacyCredential: ReturnType<typeof engine.resolveCredential>
let browserResult: OpenBrowserResult
let browserUrls: string[]
let beginSignals: Array<AbortSignal | undefined>
let savedTokens: string[]
let verifiedTokens: string[]
let fetchResult: unknown
let originalInterruptListeners: number
let scriptedChoice: { kind: 'browser' } | { kind: 'token'; token: string } | undefined
let inkActive = false
let browserOpenedDuringInk = false
let cancelPolling = false
let cancelRejectedToken = false
let mountCrash: Error | undefined
let waitCrash: Error | undefined
let clearedPrompts = 0
let unmountedPrompts = 0
const originalInkRender = ink.render

mock.module('ink', () => ({
  ...ink,
  render: (...args: Parameters<typeof ink.render>) => {
    if (scriptedChoice === undefined) return originalInkRender(...args)
    if (mountCrash !== undefined) throw mountCrash
    inkActive = true
    const props: unknown = isValidElement(args[0]) ? args[0].props : undefined
    if (typeof props === 'object' && props !== null && 'polling' in props && props.polling === true) {
      if (cancelPolling && 'onCancel' in props && typeof props.onCancel === 'function') props.onCancel()
    } else if (typeof props === 'object' && props !== null) {
      if (
        cancelRejectedToken &&
        'initialError' in props &&
        props.initialError !== undefined &&
        'onCancel' in props &&
        typeof props.onCancel === 'function'
      ) {
        props.onCancel()
      } else if (
        scriptedChoice.kind === 'browser' &&
        'onChooseBrowser' in props &&
        typeof props.onChooseBrowser === 'function'
      ) {
        props.onChooseBrowser()
      } else if (
        scriptedChoice.kind === 'token' &&
        'onSubmitToken' in props &&
        typeof props.onSubmitToken === 'function'
      ) {
        props.onSubmitToken(scriptedChoice.token)
      }
    }
    return {
      waitUntilExit: async () => {
        if (waitCrash !== undefined) throw waitCrash
      },
      clear: () => {
        clearedPrompts++
      },
      unmount: () => {
        unmountedPrompts++
        inkActive = false
      },
    }
  },
}))

mock.module('@agent-facets/engine', () => ({
  ...engine,
  beginCliLogin: async (options: { signal?: AbortSignal }) => {
    beginSignals.push(options.signal)
    return beginResult
  },
  completeCliLogin: async (_attempt: unknown, options: { signal?: AbortSignal }) => completeBehavior(options.signal),
  resolveCredential: () => legacyCredential,
  writeCredentialsToken: (token: string) => {
    savedTokens.push(token)
  },
  fetchAuthMe: async (token: string) => {
    verifiedTokens.push(token)
    return fetchResult
  },
}))
mock.module('../../../util/open-browser.ts', () => ({
  openBrowser: async (url: string) => {
    browserOpenedDuringInk = inkActive
    browserUrls.push(url)
    return browserResult
  },
}))

const { loginCommand } = await import('../index.ts')
const { run } = await import('../../../run.ts')

beforeEach(() => {
  originalInterruptListeners = process.listenerCount('SIGINT')
  beginResult = { ok: true, value: attempt }
  completeBehavior = async () => ({ ok: true, value: { username: 'verified-alice' } })
  legacyCredential = { source: 'absent' }
  browserResult = { ok: true }
  browserUrls = []
  beginSignals = []
  savedTokens = []
  verifiedTokens = []
  fetchResult = { ok: true, value: { username: 'verified-pat', tier: 'free' } }
  scriptedChoice = undefined
  inkActive = false
  browserOpenedDuringInk = false
  cancelPolling = false
  cancelRejectedToken = false
  mountCrash = undefined
  waitCrash = undefined
  clearedPrompts = 0
  unmountedPrompts = 0
})

afterEach(() => {
  expect(process.listenerCount('SIGINT')).toBe(originalInterruptListeners)
})

async function captureLogin(args: string[], interactive = false) {
  return withTTY(interactive, async () => {
    const { result: captured, stderr } = await captureStderr(() =>
      captureStdout(() => run(['login', ...args], { login: loginCommand })),
    )
    return { code: captured.result, stdout: captured.stdout, stderr }
  })
}

async function captureInteractiveLogin(args: string[], choice: { kind: 'browser' } | { kind: 'token'; token: string }) {
  scriptedChoice = choice
  try {
    return await captureLogin(args, true)
  } finally {
    scriptedChoice = undefined
  }
}

describe('facet login command routing', () => {
  test('requires an explicit mode without a terminal and rejects conflicting or malformed flags', async () => {
    for (const args of [
      [],
      ['--browser', '--token'],
      ['--no-browser', '--token'],
      ['--token', 'unexpected'],
      ['--wrong-flag'],
    ]) {
      const result = await captureLogin(args)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('fix:')
    }
    const wrong = await withTTY(false, () => captureStderr(() => loginCommand.run([], { browser: 'yes' })))
    expect(wrong.result).toBe(1)
    expect(wrong.stderr).toContain('invalid login arguments')
    expect(beginSignals).toHaveLength(0)
  })

  test('--no-browser is the actual parser false flag and completes manually without a TTY', async () => {
    const result = await captureLogin(['--no-browser'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Visit https://login.example/device')
    expect(result.stdout).toContain('Enter code: ABCD-1234')
    expect(result.stdout).toContain('Logged in as verified-alice')
    expect(result.stdout).not.toContain(attempt.display.verificationUriComplete)
    expect(result.stdout).not.toContain(canary)
    expect(result.stderr).not.toContain(canary)
    expect(browserUrls).toHaveLength(0)
    expect(beginSignals).toHaveLength(1)
    expect(beginSignals[0]).toBeInstanceOf(AbortSignal)
    expect(savedTokens).toHaveLength(0)
  })

  test('--browser launches only the verified complete URL and permits manual recovery on browser failure', async () => {
    browserResult = { ok: false, code: 'LAUNCH_FAILED' }
    const result = await captureLogin(['--browser'])
    expect(result.code).toBe(0)
    expect(browserUrls).toEqual([attempt.display.verificationUriComplete])
    expect(result.stdout).toContain('browser could not be opened')
    expect(result.stdout).toContain('Logged in as verified-alice')
    expect(result.stdout).not.toContain(canary)
  })

  test('default interactive menu choice enters browser flow after Ink teardown', async () => {
    const result = await captureInteractiveLogin([], { kind: 'browser' })
    expect(result).toEqual(expect.objectContaining({ code: 0 }))
    expect(browserUrls).toEqual([attempt.display.verificationUriComplete])
    expect(browserOpenedDuringInk).toBe(false)
    expect(result.stdout).toContain('Logged in as verified-alice')
    expect(result.stdout).not.toContain(canary)
  })

  test('a rejected Ink wait propagates the crash after clearing and unmounting once', async () => {
    const crash = new Error('ink-wait-crash-canary')
    waitCrash = crash
    await expect(captureInteractiveLogin([], { kind: 'browser' })).rejects.toBe(crash)
    expect(clearedPrompts).toBe(1)
    expect(unmountedPrompts).toBe(1)
    expect(inkActive).toBe(false)
    expect(beginSignals).toHaveLength(0)
  })

  test('an unexpected Ink mount crash propagates without continuing sign-in', async () => {
    const crash = new Error('ink-mount-crash-canary')
    mountCrash = crash
    await expect(captureInteractiveLogin([], { kind: 'browser' })).rejects.toBe(crash)
    expect(clearedPrompts).toBe(0)
    expect(unmountedPrompts).toBe(0)
    expect(beginSignals).toHaveLength(0)
  })

  test('a polling view mount crash propagates and restores the interrupt handler', async () => {
    const crash = new Error('ink-poll-mount-crash-canary')
    mountCrash = crash
    await expect(captureInteractiveLogin(['--browser'], { kind: 'browser' })).rejects.toBe(crash)
    expect(clearedPrompts).toBe(0)
    expect(unmountedPrompts).toBe(0)
    expect(beginSignals).toHaveLength(1)
    expect(process.listenerCount('SIGINT')).toBe(originalInterruptListeners)
  })

  test('--token keeps the verified PAT save path and never persists before verification', async () => {
    const result = await captureInteractiveLogin(['--token'], { kind: 'token', token: 'fct_pub_pasted' })
    expect(result).toEqual(expect.objectContaining({ code: 0 }))
    expect(verifiedTokens).toEqual(['fct_pub_pasted'])
    expect(savedTokens).toEqual(['fct_pub_pasted'])
    expect(beginSignals).toHaveLength(0)
    expect(result.stdout).toContain('Logged in as verified-pat')
    expect(result.stdout).not.toContain('fct_pub_pasted')
  })

  test('a rejected PAT is never saved and the retry prompt may be cancelled', async () => {
    fetchResult = {
      ok: false,
      error: { code: 'REGISTRY_REJECTED', wireCode: 'bad_token', error: 'Rejected', fix: 'Use another token' },
    }
    cancelRejectedToken = true
    const result = await captureInteractiveLogin(['--token'], { kind: 'token', token: 'fct_pub_rejected' })
    expect(result.code).toBe(1)
    expect(verifiedTokens).toEqual(['fct_pub_rejected'])
    expect(savedTokens).toHaveLength(0)
    expect(result.stdout).toContain('Cancelled.')
    expect(result.stdout).not.toContain('fct_pub_rejected')
  })

  test('saved PAT and FACET_TOKEN shadow browser login without overwriting either', async () => {
    for (const credential of [
      { source: 'file', token: canary },
      { source: 'env', token: canary },
    ] as const) {
      legacyCredential = credential
      const result = await captureLogin(['--no-browser'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain(credential.source === 'file' ? 'facet logout' : 'FACET_TOKEN')
      expect(result.stdout).not.toContain(canary)
      expect(savedTokens).toHaveLength(0)
    }
  })

  test('Ctrl-C aborts pending polling and restores the prior signal handler count', async () => {
    completeBehavior = (signal) =>
      new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve({ ok: false, error: { code: 'CANCELLED' } }), { once: true })
      })
    const before = process.listenerCount('SIGINT')
    const pending = captureLogin(['--no-browser'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.emit('SIGINT')
    const result = await pending
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('Cancelled.')
    expect(result.stdout).not.toContain(canary)
    expect(savedTokens).toHaveLength(0)
    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  test('a completed save remains a reported success if SIGINT arrives just after completion', async () => {
    completeBehavior = async () => {
      process.emit('SIGINT')
      return { ok: true, value: { username: 'verified-alice' } }
    }
    const result = await captureLogin(['--no-browser'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Logged in as verified-alice')
    expect(result.stdout).not.toContain('Cancelled.')
    expect(process.listenerCount('SIGINT')).toBe(originalInterruptListeners)
  })

  test('the polling view Esc callback aborts completion and preserves the previous credential', async () => {
    legacyCredential = { source: 'file', token: canary }
    cancelPolling = true
    completeBehavior = async (signal) => ({
      ok: false,
      error: { code: signal?.aborted ? 'CANCELLED' : 'UNEXPECTED_FAILURE' },
    })
    const result = await captureInteractiveLogin(['--browser'], { kind: 'browser' })
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('Cancelled.')
    expect(result.stdout).not.toContain(canary)
    expect(savedTokens).toHaveLength(0)
    expect(inkActive).toBe(false)
  })

  test('unmapped account gives safe onboarding guidance without printing provider metadata', async () => {
    completeBehavior = async () => ({
      ok: false,
      error: { code: 'ONBOARDING_REQUIRED', onboardingUrl: `https://login.example/auth/onboarding?token=${canary}` },
    })
    const result = await captureLogin(['--no-browser'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('registry account setup is required')
    expect(result.stderr).toContain('registry onboarding page')
    expect(result.stderr).not.toContain(canary)
    expect(result.stdout).not.toContain('Logged in')
    expect(savedTokens).toHaveLength(0)
  })

  test('browser configuration failure is a typed local error and never falls back to PAT', async () => {
    beginResult = { ok: false, error: { code: 'CONFIG_UNAVAILABLE', reason: 'NETWORK_ERROR' } }
    const result = await captureLogin(['--browser'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('browser sign-in configuration is unavailable')
    expect(browserUrls).toHaveLength(0)
    expect(verifiedTokens).toHaveLength(0)
  })
})
