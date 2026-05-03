import { describe, expect, test } from 'bun:test'
import { formatLatestVersionFailure, formatSelfUpdateError } from '../self-update-errors.ts'

describe('formatLatestVersionFailure', () => {
  test('network failure renders cause inline', () => {
    const out = formatLatestVersionFailure({
      ok: false,
      reason: 'network',
      url: 'https://registry.npmjs.org/agent-facets/latest',
      cause: 'ECONNREFUSED',
    })
    expect(out).toContain(
      'failed to fetch latest agent-facets version from https://registry.npmjs.org/agent-facets/latest',
    )
    expect(out).toContain('network error: ECONNREFUSED')
    expect(out).toContain('set FACET_CLI_REGISTRY to a reachable mirror')
  })

  test('http failure renders status code', () => {
    const out = formatLatestVersionFailure({
      ok: false,
      reason: 'http',
      url: 'https://npm.example.com/agent-facets/latest',
      status: 503,
    })
    expect(out).toContain('https://npm.example.com/agent-facets/latest')
    expect(out).toContain('HTTP 503')
  })

  test('invalid-json failure has stable text', () => {
    const out = formatLatestVersionFailure({
      ok: false,
      reason: 'invalid-json',
      url: 'https://registry.npmjs.org/agent-facets/latest',
    })
    expect(out).toContain('response was not valid JSON')
  })

  test('missing-version failure has stable text', () => {
    const out = formatLatestVersionFailure({
      ok: false,
      reason: 'missing-version',
      url: 'https://registry.npmjs.org/agent-facets/latest',
    })
    expect(out).toContain('response did not include a "version" field')
  })

  test('output ends with newline so it streams cleanly to stderr', () => {
    const out = formatLatestVersionFailure({
      ok: false,
      reason: 'http',
      url: 'https://x.example.com/a',
      status: 404,
    })
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('formatSelfUpdateError', () => {
  test('passes message-kind events through verbatim', () => {
    expect(formatSelfUpdateError({ kind: 'message', line: 'spawn failed: ENOENT\n' })).toBe('spawn failed: ENOENT\n')
  })

  test('routes latest-version-failure through formatLatestVersionFailure', () => {
    const out = formatSelfUpdateError({
      kind: 'latest-version-failure',
      failure: {
        ok: false,
        reason: 'network',
        url: 'https://registry.npmjs.org/agent-facets/latest',
        cause: 'timeout',
      },
    })
    expect(out).toContain('failed to fetch latest agent-facets version')
    expect(out).toContain('network error: timeout')
  })
})
