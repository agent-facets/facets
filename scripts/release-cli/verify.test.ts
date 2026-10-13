import { afterEach, beforeEach, describe, expect, type Mock, mock, spyOn, test } from 'bun:test'
import { CLI_PACKAGE_NAME } from '../lib/constants'
import { io } from '../lib/io'
import type { ProbeDiagnostics, ProbeOptions, ReadinessProbe } from '../lib/npm-readiness'
import { platformPackageNames } from './targets'
import { DEFAULT_POLICY, type Probe, type VerifyOptions, verify } from './verify'

const VERSION = '1.0.0'
const PLATFORM_PACKAGES = platformPackageNames()
const MINUTE = 60_000

const diagnostics: ProbeDiagnostics = {
  durationMs: 100,
  status: 200,
  cacheControl: null,
  age: null,
  cacheStatus: null,
  lastModified: null,
}
const READY: ReadinessProbe = { outcome: 'ready', diagnostics }
const ABSENT: ReadinessProbe = { outcome: 'version-absent', diagnostics }
const NETWORK_ERROR: ReadinessProbe = { outcome: 'network-error', detail: 'ECONNRESET', diagnostics }
const rateLimited = (retryAfterMs: number | null): ReadinessProbe => ({
  outcome: 'rate-limited',
  retryAfterMs,
  diagnostics: { ...diagnostics, status: 429 },
})

type Call = { pkg: string; at: number; timeoutMs: number }

/**
 * A fake clock where sleeping advances time instantly, plus a probe that
 * records each call and spends `requestMs` of simulated time per request.
 */
function harness(respond: (pkg: string, now: number, call: number) => ReadinessProbe, requestMs = 100) {
  let now = 0
  const sleeps: number[] = []
  const calls: Call[] = []
  const probe: Probe = async (pkg: string, _version: string, options: ProbeOptions) => {
    const at = now
    calls.push({ pkg, at, timeoutMs: options.timeoutMs })
    const result = respond(pkg, at, calls.filter((c) => c.pkg === pkg).length)
    now += Math.min(requestMs, options.timeoutMs)
    return result
  }
  const options: Partial<VerifyOptions> = {
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        now += ms
      },
    },
    probe,
  }
  return { options, calls, sleeps, now: () => now, callsFor: (pkg: string) => calls.filter((c) => c.pkg === pkg) }
}

describe('verify.ts', () => {
  let errorSpy: Mock<(...args: unknown[]) => void>

  beforeEach(() => {
    spyOn(io.console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(io.console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  test('succeeds in one round without waiting when everything is available', async () => {
    const h = harness(() => READY)

    const result = await verify(PLATFORM_PACKAGES, VERSION, h.options)

    expect(result).toEqual({ ok: true, elapsedMs: 1_200, rounds: 1 })
    expect(h.calls.map((c) => c.pkg)).toEqual(PLATFORM_PACKAGES)
    expect(h.sleeps).toEqual([])
  })

  test('checks only the packages it is given', async () => {
    const h = harness(() => READY)

    await verify([CLI_PACKAGE_NAME], VERSION, h.options)

    expect(h.calls.map((c) => c.pkg)).toEqual([CLI_PACKAGE_NAME])
  })

  test('keeps checking the rest of a round after a package is missing or a request fails', async () => {
    const [first, second] = PLATFORM_PACKAGES as [string, string]
    const h = harness((pkg, _now, call) => {
      if (pkg === first && call === 1) return ABSENT
      if (pkg === second && call === 1) return NETWORK_ERROR
      return READY
    })

    const result = await verify(PLATFORM_PACKAGES, VERSION, h.options)

    if (!result.ok) expect.unreachable()
    expect(result.rounds).toBe(2)
    // Round 1 reached every package despite the first two failing.
    expect(h.calls.slice(0, PLATFORM_PACKAGES.length).map((c) => c.pkg)).toEqual(PLATFORM_PACKAGES)
    // Round 2 rechecked only the two that were not available.
    expect(h.calls.slice(PLATFORM_PACKAGES.length).map((c) => c.pkg)).toEqual([first, second])
  })

  test('never rechecks a package once it is available', async () => {
    const late = PLATFORM_PACKAGES[5] ?? ''
    const h = harness((pkg, now) => (pkg === late && now < 3 * MINUTE ? ABSENT : READY))

    await verify(PLATFORM_PACKAGES, VERSION, h.options)

    for (const pkg of PLATFORM_PACKAGES) {
      if (pkg !== late) expect(h.callsFor(pkg)).toHaveLength(1)
    }
    expect(h.callsFor(late).length).toBeGreaterThan(1)
  })

  test('waits through a seven-plus minute npm processing delay', async () => {
    // The 0.36.0 release: the last platform package appeared ~7m25s after upload.
    const late = '@agent-facets/cli-linux-x64-baseline-musl'
    expect(PLATFORM_PACKAGES).toContain(late)
    const h = harness((pkg, now) => (pkg === late && now < 7 * MINUTE + 25_000 ? ABSENT : READY))

    const result = await verify(PLATFORM_PACKAGES, VERSION, h.options)

    if (!result.ok) expect.unreachable()
    expect(result.elapsedMs).toBeGreaterThan(7 * MINUTE)
    expect(result.elapsedMs).toBeLessThan(DEFAULT_POLICY.deadlineMs)
    // Every wait between rounds is the poll interval.
    expect(new Set(h.sleeps)).toEqual(new Set([DEFAULT_POLICY.pollIntervalMs]))
  })

  test('fails at the deadline when a package never appears, reporting its last check', async () => {
    const missing = PLATFORM_PACKAGES[0] ?? ''
    const h = harness((pkg) => (pkg === missing ? ABSENT : READY))

    const result = await verify(PLATFORM_PACKAGES, VERSION, h.options)

    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('deadline')
    expect(result.unresolved).toEqual([{ pkg: missing, last: ABSENT }])
    expect(result.elapsedMs).toBeLessThanOrEqual(DEFAULT_POLICY.deadlineMs)
    // No request ever started at or after the deadline.
    expect(Math.max(...h.calls.map((c) => c.at))).toBeLessThan(DEFAULT_POLICY.deadlineMs)
    const errors = errorSpy.mock.calls.map((args) => String(args[0])).join('\n')
    expect(errors).toContain(`✗ ${missing}@${VERSION} — last check: not available yet`)
  })

  test('caps each request timeout at the remaining budget', async () => {
    const h = harness(() => ABSENT, 0)

    const result = await verify([CLI_PACKAGE_NAME], VERSION, {
      ...h.options,
      deadlineMs: 12_000,
      pollIntervalMs: 5_000,
      requestTimeoutMs: 10_000,
    })

    expect(result.ok).toBe(false)
    expect(h.calls.map((c) => [c.at, c.timeoutMs])).toEqual([
      [0, 10_000],
      [5_000, 7_000],
      [10_000, 2_000],
    ])
  })

  test('treats a timed-out request as not yet available and keeps polling', async () => {
    const h = harness((_pkg, _now, call) =>
      call === 1 ? { outcome: 'timeout', timeoutMs: 10_000, diagnostics: { ...diagnostics, status: null } } : READY,
    )

    const result = await verify([CLI_PACKAGE_NAME], VERSION, h.options)

    if (!result.ok) expect.unreachable()
    expect(result.rounds).toBe(2)
  })

  test('pauses all requests for Retry-After on a 429, then resumes the same round', async () => {
    const [a, b, c] = PLATFORM_PACKAGES as [string, string, string]
    const h = harness((pkg, _now, call) => (pkg === a && call === 1 ? rateLimited(90_000) : READY))

    const result = await verify([a, b, c], VERSION, { ...h.options, heartbeatMs: 10 * MINUTE })

    if (!result.ok) expect.unreachable()
    expect(h.sleeps[0]).toBe(90_000)
    // b and c ran in round 1 after the cooldown; a was not immediately retried.
    expect(h.calls.map((call) => call.pkg)).toEqual([a, b, c, a])
    expect(h.callsFor(b)[0]?.at).toBeGreaterThanOrEqual(90_000)
  })

  test('uses the minimum cooldown when Retry-After is short or absent', async () => {
    for (const retryAfter of [5_000, null]) {
      const [a, b] = PLATFORM_PACKAGES as [string, string]
      const h = harness((pkg, _now, call) => (pkg === a && call === 1 ? rateLimited(retryAfter) : READY))

      await verify([a, b], VERSION, h.options)

      expect(h.sleeps[0]).toBe(DEFAULT_POLICY.rateLimitCooldownMs)
    }
  })

  test('stops instead of sleeping past the deadline, reporting unchecked packages', async () => {
    const [a, b] = PLATFORM_PACKAGES as [string, string]
    const h = harness((pkg) => (pkg === a ? rateLimited(30 * MINUTE) : READY))

    const result = await verify([a, b], VERSION, h.options)

    if (result.ok) expect.unreachable()
    expect(h.sleeps).toEqual([])
    expect(result.unresolved).toEqual([
      { pkg: a, last: rateLimited(30 * MINUTE) },
      { pkg: b, last: null },
    ])
  })

  test('logs a heartbeat during long waits', async () => {
    const [a, b] = PLATFORM_PACKAGES as [string, string]
    const h = harness((pkg, _now, call) => (pkg === a && call === 1 ? rateLimited(150_000) : READY))

    await verify([a, b], VERSION, h.options)

    expect(h.sleeps.slice(0, 3)).toEqual([60_000, 60_000, 30_000])
  })
})
