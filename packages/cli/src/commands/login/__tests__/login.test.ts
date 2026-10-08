import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as engine from '@agent-facets/engine'
import * as ink from 'ink'
import { isValidElement } from 'react'
import { captureStderr, captureStdout } from '../../../__tests__/helpers/capture-std.ts'
import { withTTY } from '../../../__tests__/helpers/with-tty.ts'
import * as browser from '../../../util/open-browser.ts'

const canary = 'device-secret-canary-must-not-print'
const expectedDisplay = {
  verificationUri: 'https://login.example/device',
  verificationUriComplete: 'https://login.example/device?user_code=ABCD-1234',
  userCode: 'ABCD-1234',
}
const registry = 'https://registry.example'
const clientId = 'client_01HZXYPJYQ8V7Z9M4G3K2N1P0R'
const authorizationEndpoint = 'https://api.workos.com/user_management/authorize/device'
const tokenEndpoint = 'https://api.workos.com/user_management/authenticate'
const now = 2_000_000_000_000

let beginResult: Awaited<ReturnType<typeof engine.beginCliLogin>>
let completeBehavior: (signal?: AbortSignal) => ReturnType<typeof engine.completeCliLogin>
let legacyCredential: ReturnType<typeof engine.resolveCredential>
let browserResult: browser.OpenBrowserResult
let browserUrls: string[]
let beginSignals: Array<AbortSignal | undefined>
let savedTokens: string[]
let verifiedTokens: string[]
let fetchResult: Awaited<ReturnType<typeof engine.fetchAuthMe>>
let originalInterruptListeners: number
let scriptedChoice: { kind: 'browser' } | { kind: 'token'; token: string } | undefined
let inkActive = false
let browserOpenedDuringInk = false
let cancelPolling = false
let cancelRejectedToken = false
let mountCrash: Error | undefined
let waitCrash: Error | undefined
let rejectPollingWait: ((error: Error) => void) | undefined
let pollingWaitOnUnmount: Error | undefined
let clearedPrompts = 0
let unmountedPrompts = 0
let facetDir: string
let originalFacetDir: string | undefined
let originalToken: string | undefined
let restoreSpies: Array<() => void> = []
const originalBeginCliLogin = engine.beginCliLogin
const originalInkRender = ink.render

function fakeInkRender(...args: Parameters<typeof ink.render>): ReturnType<typeof ink.render> {
  if (scriptedChoice === undefined) return originalInkRender(...args)
  if (mountCrash !== undefined) throw mountCrash
  inkActive = true
  const props: unknown = isValidElement(args[0]) ? args[0].props : undefined
  const polling = typeof props === 'object' && props !== null && 'polling' in props && props.polling === true
  let pollingWait: Promise<void> | undefined
  let resolvePollingWait: (() => void) | undefined
  if (polling) {
    pollingWait = new Promise<void>((resolve, reject) => {
      resolvePollingWait = resolve
      rejectPollingWait = reject
    })
    // The fixture owns its rejection until the command attaches its observer.
    void pollingWait.catch(() => {})
  }
  if (polling) {
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
    rerender: () => {},
    waitUntilRenderFlush: async () => {},
    waitUntilExit: () => {
      if (waitCrash !== undefined) throw waitCrash
      return pollingWait ?? Promise.resolve()
    },
    cleanup: () => {},
    clear: () => {
      clearedPrompts++
    },
    unmount: () => {
      unmountedPrompts++
      inkActive = false
      if (pollingWaitOnUnmount !== undefined) rejectPollingWait?.(pollingWaitOnUnmount)
      else resolvePollingWait?.()
    },
  }
}

function profile(username: string): engine.WireAuthMeResponse {
  return {
    user_uuid: 'registry-user-uuid',
    username,
    email: 'user@example.test',
    tier: 'free',
    suspended: false,
    startup_experience: { kind: 'landing-only' },
    getting_started: { kind: 'unavailable' },
  }
}

async function realBrandedAttempt(): ReturnType<typeof engine.beginCliLogin> {
  const fetcher = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init)
    let body: unknown
    if (request.url.endsWith('/v0/auth/cli/config')) {
      body = {
        enabled: true,
        provider: 'workos',
        client_id: clientId,
        issuer: `https://api.workos.com/user_management/${clientId}`,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: tokenEndpoint,
        verification_origin: 'https://login.example',
        onboarding_url: 'https://app.example/auth/onboarding',
      }
    } else if (request.url === authorizationEndpoint) {
      body = {
        device_code: canary,
        user_code: expectedDisplay.userCode,
        verification_uri: expectedDisplay.verificationUri,
        verification_uri_complete: expectedDisplay.verificationUriComplete,
        expires_in: 300,
        interval: 5,
      }
    } else {
      throw new Error(`unexpected login fixture request: ${request.url}`)
    }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }
  fetcher.preconnect = globalThis.fetch.preconnect
  const result = await originalBeginCliLogin({ registryUrl: registry, fetch: fetcher, now: () => now })
  if (!result.ok) expect.unreachable(`real login fixture failed: ${result.error.code}`)
  expect(result.value.display).toEqual(expectedDisplay)
  expect(JSON.stringify(result.value)).not.toContain(canary)
  return result
}

const { loginCommand } = await import('../index.ts')
const { run } = await import('../../../run.ts')

async function setupLoginFixture(): Promise<void> {
  restoreSpies = []
  originalFacetDir = process.env.FACET_DIR
  originalToken = process.env.FACET_TOKEN
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'login-command-test-')))
  chmodSync(facetDir, 0o700)
  process.env.FACET_DIR = facetDir
  delete process.env.FACET_TOKEN
  originalInterruptListeners = process.listenerCount('SIGINT')
  beginResult = await realBrandedAttempt()
  completeBehavior = async () => ({ ok: true, value: profile('verified-alice') })
  legacyCredential = { source: 'absent' }
  browserResult = { ok: true }
  browserUrls = []
  beginSignals = []
  savedTokens = []
  verifiedTokens = []
  fetchResult = { ok: true, value: profile('verified-pat') }
  scriptedChoice = undefined
  inkActive = false
  browserOpenedDuringInk = false
  cancelPolling = false
  cancelRejectedToken = false
  mountCrash = undefined
  waitCrash = undefined
  rejectPollingWait = undefined
  pollingWaitOnUnmount = undefined
  clearedPrompts = 0
  unmountedPrompts = 0
  const beginSpy = spyOn(engine, 'beginCliLogin').mockImplementation(async (options = {}) => {
    beginSignals.push(options.signal)
    return beginResult
  })
  restoreSpies.push(() => beginSpy.mockRestore())
  const completeSpy = spyOn(engine, 'completeCliLogin').mockImplementation(async (_attempt, options = {}) =>
    completeBehavior(options.signal),
  )
  restoreSpies.push(() => completeSpy.mockRestore())
  const credentialSpy = spyOn(engine, 'resolveCredential').mockImplementation(() => legacyCredential)
  restoreSpies.push(() => credentialSpy.mockRestore())
  const writerSpy = spyOn(engine, 'writeCredentialsToken').mockImplementation((token) => {
    savedTokens.push(token)
  })
  restoreSpies.push(() => writerSpy.mockRestore())
  const profileSpy = spyOn(engine, 'fetchAuthMe').mockImplementation(async (token) => {
    verifiedTokens.push(token)
    return fetchResult
  })
  restoreSpies.push(() => profileSpy.mockRestore())
  const inkSpy = spyOn(ink, 'render').mockImplementation(fakeInkRender)
  restoreSpies.push(() => inkSpy.mockRestore())
  const browserSpy = spyOn(browser, 'openBrowser').mockImplementation(async (url) => {
    browserOpenedDuringInk = inkActive
    browserUrls.push(url)
    return browserResult
  })
  restoreSpies.push(() => browserSpy.mockRestore())
}

function cleanupLoginFixture(): void {
  try {
    expect(process.listenerCount('SIGINT')).toBe(originalInterruptListeners)
  } finally {
    for (const restore of restoreSpies.reverse()) restore()
    rmSync(facetDir, { recursive: true, force: true })
    if (originalFacetDir === undefined) delete process.env.FACET_DIR
    else process.env.FACET_DIR = originalFacetDir
    if (originalToken === undefined) delete process.env.FACET_TOKEN
    else process.env.FACET_TOKEN = originalToken
  }
}

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
  beforeEach(setupLoginFixture)
  afterEach(cleanupLoginFixture)

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
    expect(result.stdout).not.toContain(expectedDisplay.verificationUriComplete)
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
    expect(browserUrls).toEqual([expectedDisplay.verificationUriComplete])
    expect(result.stdout).toContain('browser could not be opened')
    expect(result.stdout).toContain('Logged in as verified-alice')
    expect(result.stdout).not.toContain(canary)
  })

  test('default interactive menu choice enters browser flow after Ink teardown', async () => {
    const result = await captureInteractiveLogin([], { kind: 'browser' })
    expect(result).toEqual(expect.objectContaining({ code: 0 }))
    expect(browserUrls).toEqual([expectedDisplay.verificationUriComplete])
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

  test('a deferred polling view crash aborts pending authentication and propagates once', async () => {
    const crash = new Error('ink-deferred-poll-crash-canary')
    const writes: string[] = []
    let enteredCompletion: () => void = () => {}
    const completionStarted = new Promise<void>((resolve) => {
      enteredCompletion = resolve
    })
    let completionSignal: AbortSignal | undefined
    let finishCompletion: (() => void) | undefined
    completeBehavior = (signal) => {
      completionSignal = signal
      enteredCompletion()
      return new Promise((resolve) => {
        finishCompletion = () => resolve({ ok: false, error: { code: 'CANCELLED' } })
        signal?.addEventListener('abort', () => resolve({ ok: false, error: { code: 'CANCELLED' } }), { once: true })
      })
    }
    scriptedChoice = { kind: 'browser' }
    const outputSpy = spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => {
      writes.push(String(chunk))
      const done = rest.find((value): value is (error?: Error | null) => void => typeof value === 'function')
      done?.()
      return true
    })
    try {
      const pending = withTTY(true, () => run(['login', '--browser'], { login: loginCommand }))
      await completionStarted
      rejectPollingWait?.(crash)
      await Promise.resolve()
      finishCompletion?.()
      await expect(pending).rejects.toBe(crash)
    } finally {
      outputSpy.mockRestore()
      scriptedChoice = undefined
    }
    expect(completionSignal?.aborted).toBe(true)
    expect(writes.join('')).not.toContain('Logged in')
    expect(clearedPrompts).toBe(1)
    expect(unmountedPrompts).toBe(1)
    expect(inkActive).toBe(false)
    expect(savedTokens).toHaveLength(0)
    expect(process.listenerCount('SIGINT')).toBe(originalInterruptListeners)
  })

  test('a polling view failure during teardown overrides success without a late rejection', async () => {
    const crash = new Error('ink-late-poll-crash-canary')
    pollingWaitOnUnmount = crash
    const writes: string[] = []
    scriptedChoice = { kind: 'browser' }
    const outputSpy = spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => {
      writes.push(String(chunk))
      const done = rest.find((value): value is (error?: Error | null) => void => typeof value === 'function')
      done?.()
      return true
    })
    try {
      await expect(withTTY(true, () => run(['login', '--browser'], { login: loginCommand }))).rejects.toBe(crash)
    } finally {
      outputSpy.mockRestore()
      scriptedChoice = undefined
    }
    expect(writes.join('')).not.toContain('Logged in')
    expect(clearedPrompts).toBe(1)
    expect(unmountedPrompts).toBe(1)
    expect(inkActive).toBe(false)
    expect(savedTokens).toHaveLength(0)
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
      error: {
        code: 'REGISTRY_REJECTED',
        wireCode: 'bad_token',
        error: 'Rejected',
        fix: 'Use another token',
        docsUrl: 'https://registry.example/docs/tokens',
      },
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
      return { ok: true, value: profile('verified-alice') }
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
    beginResult = { ok: false, error: { code: 'CONFIG_UNAVAILABLE', reason: 'CLI_CONFIG_UNAVAILABLE' } }
    const result = await captureLogin(['--browser'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('browser sign-in configuration is unavailable')
    expect(browserUrls).toHaveLength(0)
    expect(verifiedTokens).toHaveLength(0)
  })
})
