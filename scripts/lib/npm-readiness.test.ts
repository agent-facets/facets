import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { io } from './io'
import { describeProbe, packumentUrl, parseRetryAfter, probeVersion } from './npm-readiness'

const PKG = '@agent-facets/cli-linux-x64'
const VERSION = '0.36.0'

function packument(versions: Record<string, unknown>, name = PKG): string {
  return JSON.stringify({ name, 'dist-tags': { latest: VERSION }, versions })
}

function respond(body: string | null, status = 200, headers: Record<string, string> = {}) {
  return spyOn(io.npm, 'fetchPackument').mockResolvedValue(new Response(body, { status, headers }))
}

/** A clock that advances 25ms on every read, so durations are deterministic. */
function steppingClock(start = 1_000_000) {
  let t = start - 25
  return () => {
    t += 25
    return t
  }
}

const CACHE_HEADERS = {
  'cache-control': 'public, max-age=300',
  age: '53',
  'cf-cache-status': 'HIT',
  'last-modified': 'Mon, 12 Oct 2026 19:06:36 GMT',
}

const CACHE_DIAGNOSTICS = {
  cacheControl: 'public, max-age=300',
  age: '53',
  cacheStatus: 'HIT',
  lastModified: 'Mon, 12 Oct 2026 19:06:36 GMT',
}

/** Capture the probe's deadline timer so a test expires it at a chosen moment instead of waiting. */
function controlDeadline() {
  let expire: (() => void) | undefined
  spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
    expire = callback
    return 0
  }) as unknown as typeof setTimeout)
  spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
  return {
    expire: () => {
      if (!expire) expect.unreachable()
      expire()
    },
  }
}

/** A body that never delivers data, recording whether it was cancelled. */
function stalledBody(onCancel: () => void | PromiseLike<void> = () => {}) {
  const state = { cancelled: false }
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true
      return onCancel()
    },
  })
  return { stream, state }
}

describe('packumentUrl', () => {
  test('escapes the slash in a scoped name the way npm does', () => {
    expect(packumentUrl(PKG)).toBe('https://registry.npmjs.org/@agent-facets%2fcli-linux-x64')
  })

  test('leaves unscoped names unchanged', () => {
    expect(packumentUrl('agent-facets')).toBe('https://registry.npmjs.org/agent-facets')
  })
})

describe('parseRetryAfter', () => {
  test('parses delta-seconds', () => {
    expect(parseRetryAfter('60', 0)).toBe(60_000)
    expect(parseRetryAfter(' 0 ', 0)).toBe(0)
  })

  test('parses an HTTP-date relative to now', () => {
    const now = Date.parse('Mon, 12 Oct 2026 19:00:00 GMT')
    expect(parseRetryAfter('Mon, 12 Oct 2026 19:01:30 GMT', now)).toBe(90_000)
    expect(parseRetryAfter('Mon, 12 Oct 2026 18:59:00 GMT', now)).toBe(0)
  })

  test('returns null when absent or unparseable', () => {
    expect(parseRetryAfter(null, 0)).toBeNull()
    expect(parseRetryAfter('soon', 0)).toBeNull()
  })
})

describe('probeVersion', () => {
  afterEach(() => {
    mock.restore()
  })

  test('requests the escaped packument URL with an abort signal', async () => {
    const fetchSpy = respond(packument({ [VERSION]: { name: PKG, version: VERSION } }))

    await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    const [url, signal] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('https://registry.npmjs.org/@agent-facets%2fcli-linux-x64')
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  test('reports ready with captured diagnostics', async () => {
    respond(packument({ [VERSION]: { name: PKG, version: VERSION } }), 200, {
      'cache-control': 'public, max-age=300',
      age: '53',
      'cf-cache-status': 'HIT',
      'last-modified': 'Mon, 12 Oct 2026 19:06:36 GMT',
    })

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000, now: steppingClock() })

    expect(result).toEqual({
      outcome: 'ready',
      diagnostics: {
        durationMs: 25,
        status: 200,
        cacheControl: 'public, max-age=300',
        age: '53',
        cacheStatus: 'HIT',
        lastModified: 'Mon, 12 Oct 2026 19:06:36 GMT',
      },
    })
  })

  test('reports version-absent when the packument lacks the version', async () => {
    respond(packument({ '0.35.0': { name: PKG, version: '0.35.0' } }))

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    expect(result.outcome).toBe('version-absent')
    expect(result.diagnostics.status).toBe(200)
  })

  test('reports version-absent when the package is not found', async () => {
    respond('{"error":"Not found"}', 404)

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    expect(result.outcome).toBe('version-absent')
    expect(result.diagnostics.status).toBe(404)
  })

  test('reports rate limiting with the Retry-After delay', async () => {
    respond(null, 429, { 'retry-after': '120' })

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    if (result.outcome !== 'rate-limited') expect.unreachable()
    expect(result.retryAfterMs).toBe(120_000)
  })

  test('reports rate limiting without a Retry-After header', async () => {
    respond(null, 429)

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    if (result.outcome !== 'rate-limited') expect.unreachable()
    expect(result.retryAfterMs).toBeNull()
  })

  test('reports other statuses as http-error', async () => {
    respond('upstream unavailable', 503)

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    if (result.outcome !== 'http-error') expect.unreachable()
    expect(result.status).toBe(503)
  })

  test('reports a non-JSON body as invalid metadata', async () => {
    respond('<html>oops</html>')

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    if (result.outcome !== 'invalid-metadata') expect.unreachable()
    expect(result.detail).toContain('not JSON')
  })

  test('reports a packument for another package as invalid metadata', async () => {
    respond(packument({ [VERSION]: { name: 'other', version: VERSION } }, 'other'))

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    expect(result.outcome).toBe('invalid-metadata')
  })

  test('reports a mismatched version entry as invalid metadata', async () => {
    respond(packument({ [VERSION]: { name: PKG, version: '0.35.0' } }))

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    expect(result.outcome).toBe('invalid-metadata')
  })

  test('reports a rejected request as a network error', async () => {
    spyOn(io.npm, 'fetchPackument').mockRejectedValue(new Error('ECONNRESET'))

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 1_000 })

    if (result.outcome !== 'network-error') expect.unreachable()
    expect(result.detail).toBe('ECONNRESET')
    expect(result.diagnostics.status).toBeNull()
  })

  test('aborts and reports a timeout with no response when headers never arrive', async () => {
    const deadline = controlDeadline()
    let seenSignal: AbortSignal | undefined
    spyOn(io.npm, 'fetchPackument').mockImplementation(
      (_url: string, signal: AbortSignal) =>
        new Promise<Response>((_resolve, reject) => {
          seenSignal = signal
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const probe = probeVersion(PKG, VERSION, { timeoutMs: 10_000 })
    deadline.expire()
    const result = await probe

    if (result.outcome !== 'timeout') expect.unreachable()
    expect(result.timeoutMs).toBe(10_000)
    expect(result.diagnostics.status).toBeNull()
    expect(seenSignal?.aborted).toBe(true)
  })

  test('keeps the response diagnostics when the body read stalls, even if the signal is ignored', async () => {
    const deadline = controlDeadline()
    let bodyRequested: () => void = () => {}
    const reading = new Promise<void>((resolve) => {
      bodyRequested = resolve
    })
    // highWaterMark 0: pull runs only once the probe starts reading the body,
    // which is after it has seen the headers.
    const stalled = new ReadableStream<Uint8Array>(
      {
        pull() {
          bodyRequested()
          return new Promise(() => {})
        },
      },
      { highWaterMark: 0 },
    )
    spyOn(io.npm, 'fetchPackument').mockResolvedValue(new Response(stalled, { status: 200, headers: CACHE_HEADERS }))

    const probe = probeVersion(PKG, VERSION, { timeoutMs: 10_000, now: steppingClock() })
    await reading
    deadline.expire()
    const result = await probe

    expect(result).toEqual({
      outcome: 'timeout',
      timeoutMs: 10_000,
      diagnostics: { durationMs: 25, status: 200, ...CACHE_DIAGNOSTICS },
    })
    expect(describeProbe(result)).toBe(
      'request timed out after 10000ms [HTTP 200, 25ms, cache HIT, age 53s, public, max-age=300, ' +
        'modified Mon, 12 Oct 2026 19:06:36 GMT]',
    )
  })

  test('keeps the response diagnostics when the body read fails', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset mid-body'))
      },
    })
    spyOn(io.npm, 'fetchPackument').mockResolvedValue(new Response(failing, { status: 200, headers: CACHE_HEADERS }))

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 10_000, now: steppingClock() })

    expect(result).toEqual({
      outcome: 'network-error',
      detail: 'connection reset mid-body',
      diagnostics: { durationMs: 25, status: 200, ...CACHE_DIAGNOSTICS },
    })
    expect(describeProbe(result)).not.toContain('no response')
  })

  describe('unread bodies', () => {
    test.each([
      { status: 404, outcome: 'version-absent' },
      { status: 429, outcome: 'rate-limited' },
      { status: 503, outcome: 'http-error' },
    ])('cancels a stalled $status body and aborts the request', async ({ status, outcome }) => {
      const { stream, state } = stalledBody()
      let seenSignal: AbortSignal | undefined
      spyOn(io.npm, 'fetchPackument').mockImplementation(async (_url: string, signal: AbortSignal) => {
        seenSignal = signal
        return new Response(stream, { status, headers: { 'retry-after': '120' } })
      })

      const result = await probeVersion(PKG, VERSION, { timeoutMs: 10_000 })

      expect(result.outcome).toBe(outcome)
      expect(result.diagnostics.status).toBe(status)
      if (result.outcome === 'rate-limited') expect(result.retryAfterMs).toBe(120_000)
      expect(state.cancelled).toBe(true)
      expect(seenSignal?.aborted).toBe(true)
    })

    test('does not wait for a cancellation that never settles', async () => {
      const { stream, state } = stalledBody(() => new Promise(() => {}))
      spyOn(io.npm, 'fetchPackument').mockResolvedValue(new Response(stream, { status: 503 }))

      const result = await probeVersion(PKG, VERSION, { timeoutMs: 10_000 })

      if (result.outcome !== 'http-error') expect.unreachable()
      expect(result.status).toBe(503)
      expect(state.cancelled).toBe(true)
    })

    test('keeps the observed outcome when cancellation fails', async () => {
      const { stream, state } = stalledBody(() => Promise.reject(new Error('cancel failed')))
      spyOn(io.npm, 'fetchPackument').mockResolvedValue(
        new Response(stream, { status: 429, headers: { 'retry-after': '60' } }),
      )

      const result = await probeVersion(PKG, VERSION, { timeoutMs: 10_000 })

      if (result.outcome !== 'rate-limited') expect.unreachable()
      expect(result.retryAfterMs).toBe(60_000)
      expect(state.cancelled).toBe(true)
    })
  })
})

describe('describeProbe', () => {
  const diagnostics = {
    durationMs: 95,
    status: 200,
    cacheControl: null,
    age: '53',
    cacheStatus: 'HIT',
    lastModified: null,
  }

  test('describes absence with diagnostics', () => {
    expect(describeProbe({ outcome: 'version-absent', diagnostics })).toBe(
      'not available yet: version not in packument [HTTP 200, 95ms, cache HIT, age 53s]',
    )
  })

  test('describes rate limiting with its Retry-After', () => {
    expect(
      describeProbe({ outcome: 'rate-limited', retryAfterMs: 60_000, diagnostics: { ...diagnostics, status: 429 } }),
    ).toContain('rate limited, Retry-After 60s')
  })

  test('describes a request with no response', () => {
    expect(
      describeProbe({
        outcome: 'timeout',
        timeoutMs: 10_000,
        diagnostics: { ...diagnostics, status: null, age: null, cacheStatus: null },
      }),
    ).toBe('request timed out after 10000ms [no response, 95ms]')
  })
})
