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

  test('aborts and reports a timeout when the response never arrives', async () => {
    let seenSignal: AbortSignal | undefined
    spyOn(io.npm, 'fetchPackument').mockImplementation(
      (_url: string, signal: AbortSignal) =>
        new Promise<Response>((_resolve, reject) => {
          seenSignal = signal
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 5 })

    if (result.outcome !== 'timeout') expect.unreachable()
    expect(result.timeoutMs).toBe(5)
    expect(seenSignal?.aborted).toBe(true)
  })

  test('times out when the body read stalls, even if the signal is ignored', async () => {
    const stalled = new ReadableStream<Uint8Array>({ start() {} })
    spyOn(io.npm, 'fetchPackument').mockResolvedValue(new Response(stalled, { status: 200 }))

    const result = await probeVersion(PKG, VERSION, { timeoutMs: 5 })

    expect(result.outcome).toBe('timeout')
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
