import { describe, expect, test } from 'bun:test'
import {
  isRegistryErrorResponse,
  type RegistryErrorCode,
  type RegistryErrorResponse,
  translateRegistryError,
} from '../registry-errors.ts'

/**
 * Test factory that returns a `RegistryErrorResponse`-shaped object
 * with the given `code`. Accepts known codes directly and accepts an
 * arbitrary string via the second overload — the latter exists so the
 * unknown-code fallback test below can construct an `E_FUTURE_CODE`
 * fixture without a wider cast at the call site.
 */
function stubResponse(code: RegistryErrorCode): RegistryErrorResponse
function stubResponse(code: string): RegistryErrorResponse
function stubResponse(code: string): RegistryErrorResponse {
  return {
    error: `the server's human message about ${code}`,
    code: code as RegistryErrorCode,
    docsUrl: `https://agentfacets.io/errors/${code}`,
  }
}

describe('translateRegistryError', () => {
  // Each canonical code must map to a non-generic, non-empty fix line.
  // If a future code lands in the response without a mapping, it should
  // fall through to the unknown-code branch — exercised separately below.
  const canonicalCodes: ReadonlyArray<readonly [RegistryErrorCode, string]> = [
    ['E_FACET_NOT_FOUND', "try 'facet search <term>' to find available facets"],
    ['E_REGISTRY_UNAVAILABLE', 'try again in a moment'],
    ['E_TARBALL_CORRUPTED', 'try again; if persistent, check your network'],
    ['E_TARBALL_TOO_LARGE', 'reduce the facet contents below 5 MB or split into multiple facets'],
    ['E_API_KEY_MISSING', 'set FACET_REGISTRY_API_KEY in your environment'],
    ['VERSION_EXISTS', 'bump `version` in facet.json and try again'],
  ]

  test.each(canonicalCodes)('%s maps to its canonical fix', (code, expectedFix) => {
    const cli = translateRegistryError(stubResponse(code))
    expect(cli.fix).toBe(expectedFix)
    expect(cli.detail).toBe(`the server's human message about ${code}`)
    expect(cli.docsUrl).toBe(`https://agentfacets.io/errors/${code}`)
    expect(cli.what.length).toBeGreaterThan(0)
  })

  test('unknown code falls through to a generic fix and surfaces the code in `what`', () => {
    const cli = translateRegistryError(stubResponse('E_FUTURE_CODE'))
    expect(cli.fix).toBe('check the docs URL for details')
    expect(cli.what).toContain('E_FUTURE_CODE')
  })

  test('preserves the docsUrl verbatim so users can deep-link from terminal output', () => {
    const cli = translateRegistryError({
      error: 'x',
      code: 'E_FACET_NOT_FOUND',
      docsUrl: 'https://docs.example/notfound',
    })
    expect(cli.docsUrl).toBe('https://docs.example/notfound')
  })
})

describe('isRegistryErrorResponse', () => {
  test('accepts a well-formed registry error response', () => {
    expect(
      isRegistryErrorResponse({
        error: 'x',
        code: 'E_FACET_NOT_FOUND',
        docsUrl: 'https://docs',
      }),
    ).toBe(true)
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'oops'],
    ['empty object', {}],
    ['missing code', { error: 'x', docsUrl: 'y' }],
    ['missing error', { code: 'x', docsUrl: 'y' }],
    ['missing docsUrl', { error: 'x', code: 'y' }],
    ['code is non-string', { error: 'x', code: 42, docsUrl: 'y' }],
  ])('rejects %s', (_label, value) => {
    expect(isRegistryErrorResponse(value)).toBe(false)
  })
})
