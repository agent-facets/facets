import { describe, expect, test } from 'bun:test'
import { formatLatestVersionFailure, formatSelfUpdateError, formatSelfUpdateStatus } from '../self-update-errors.ts'

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

  test.each([
    'unsupported-tool',
    'metadata-unavailable',
    'invalid-metadata',
  ] as const)('renders %s guidance without suggesting an unverified command', (reason) => {
    const out = formatSelfUpdateError({
      kind: 'mise-guidance',
      reason,
    })
    expect(out).toContain('could not be safely updated automatically')
    expect(out).toContain('update the facet entry in your existing mise configuration manually')
    expect(out).not.toContain('run:')
    expect(out).not.toContain('mise use')
  })

  test.each([
    'metadata-unavailable',
    'different-formula',
  ] as const)('renders Homebrew %s guidance without a suggested installer', (reason) => {
    const out = formatSelfUpdateError({
      kind: 'homebrew-guidance',
      reason,
      executable: "/opt/Homebrew's Cellar/facet/0.36.6/bin/facet",
    })
    expect(out).toContain('owning formula could not be verified')
    expect(out).toContain("brew which-formula '/opt/Homebrew'\\''s Cellar/facet/0.36.6/bin/facet'")
    expect(out).not.toContain('curl')
  })

  test.each([
    [false, 'No update was performed.\nRun:'],
    [true, 'Would run:'],
  ] as const)('renders structured Homebrew update guidance (dryRun=%s)', (dryRun, expected) => {
    const out = formatSelfUpdateStatus({ kind: 'homebrew-update-guidance', dryRun })
    expect(out).toContain(expected)
    expect(out).toContain('brew update')
    expect(out).toContain('brew upgrade agent-facets/tap/facet')
  })

  test('renders an unsupported Homebrew version request', () => {
    const out = formatSelfUpdateError({ kind: 'homebrew-version-unsupported', requestedVersion: '0.8.0' })
    expect(out).toContain('requested Facet version (0.8.0)')
    expect(out).toContain('facet self-update --version')
  })
})
