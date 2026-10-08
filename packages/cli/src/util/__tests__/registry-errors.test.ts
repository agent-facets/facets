import { describe, expect, test } from 'bun:test'
import type { RegistryError, RegistryResult, RegistrySessionFailure } from '@agent-facets/engine'
import { translateEngineRegistryError } from '../registry-errors.ts'

describe('translateEngineRegistryError — registry-dumb rendering', () => {
  test('REGISTRY_REJECTED renders the server error and fix verbatim', () => {
    const err: RegistryError = {
      code: 'REGISTRY_REJECTED',
      wireCode: 'E_VERSION_EXISTS',
      error: "version 1.2.3 of 'cool-facet' already exists",
      fix: 'bump the version in facet.json and publish again',
      docsUrl: 'https://agentfacets.io/errors/E_VERSION_EXISTS',
    }

    const cli = translateEngineRegistryError(err)

    expect(cli.what).toBe("version 1.2.3 of 'cool-facet' already exists")
    expect(cli.fix).toBe('bump the version in facet.json and publish again')
    expect(cli.docsUrl).toBe('https://agentfacets.io/errors/E_VERSION_EXISTS')
  })

  test('REGISTRY_REJECTED does not substitute any local text for the wire code', () => {
    // Two different wire codes with identical server text must produce
    // identical CLI output: the CLI keys nothing off the code.
    const base = {
      code: 'REGISTRY_REJECTED' as const,
      error: 'the registry says no',
      fix: 'do the thing the registry suggests',
      docsUrl: 'https://docs',
    }
    const a = translateEngineRegistryError({ ...base, wireCode: 'E_FACET_NOT_FOUND' })
    const b = translateEngineRegistryError({ ...base, wireCode: 'E_SOME_FUTURE_CODE' })

    expect(a).toEqual(b)
  })

  test('UNPARSEABLE_RESPONSE is CLI-authored and carries no docs link', () => {
    const cli = translateEngineRegistryError({ code: 'UNPARSEABLE_RESPONSE', status: 502 })

    expect(cli.what).toContain('could not process')
    expect(cli.what).toContain('502')
    expect(cli.fix.length).toBeGreaterThan(0)
    expect(cli.docsUrl).toBeUndefined()
  })

  test('NOT_FOUND is CLI-authored with a search suggestion', () => {
    const cli = translateEngineRegistryError({ code: 'NOT_FOUND', name: 'cool-facet', spec: '^1' })

    expect(cli.what).toContain('cool-facet')
    expect(cli.what).toContain('^1')
    expect(cli.fix).toContain('facet search')
    expect(cli.docsUrl).toBeUndefined()
  })

  test('NETWORK_ERROR surfaces retry history when attempts > 1', () => {
    const single = translateEngineRegistryError({
      code: 'NETWORK_ERROR',
      cause: 'connection refused',
      attempts: 1,
    })
    expect(single.detail).toBe('connection refused')

    const retried = translateEngineRegistryError({
      code: 'NETWORK_ERROR',
      cause: 'connection refused',
      attempts: 3,
    })
    expect(retried.detail).toContain('after 3 attempts')
  })

  test('TOO_MANY_SPECIFIERS blames the CLI, not the registry or the project', () => {
    const cli = translateEngineRegistryError({ code: 'TOO_MANY_SPECIFIERS', limit: 100, received: 142 })

    expect(cli.detail).toContain('142')
    expect(cli.detail).toContain('100')
    expect(cli.fix).toContain('file a bug')
    expect(cli.docsUrl).toBeUndefined()
  })

  test('UNEXPECTED_ERROR surfaces the cause and asks the user to file a bug', () => {
    const cli = translateEngineRegistryError({ code: 'UNEXPECTED_ERROR', cause: 'TypeError: boom' })

    expect(cli.detail).toBe('TypeError: boom')
    expect(cli.fix).toContain('file a bug')
  })
})

describe('translateEngineRegistryError — local authentication guidance', () => {
  const secret = 'secret-canary-must-not-render'
  const cases = [
    { reason: { code: 'PAT_UNREADABLE', path: `/tmp/${secret}` }, what: 'saved registry token', fix: 'permissions' },
    {
      reason: {
        code: 'UNSUPPORTED_PLATFORM',
        guidance: 'Browser login is unavailable on this platform; use FACET_TOKEN or PAT login.',
      },
      what: 'unavailable on this platform',
      fix: 'FACET_TOKEN',
    },
    { reason: { code: 'INVALID_REGISTRY_ORIGIN' }, what: 'registry URL is invalid', fix: 'HTTPS' },
    {
      reason: { code: 'CONFIG_UNAVAILABLE', reason: 'CLI_CONFIG_UNAVAILABLE', status: 503 },
      what: 'configuration is unavailable',
      fix: 'reachability',
    },
    { reason: { code: 'STATE_UNAVAILABLE', reason: 'IO_ERROR' }, what: 'local sign-in state', fix: 'ownership' },
    {
      reason: { code: 'DEVICE_AUTH_FAILED', reason: 'POLLING_UNAVAILABLE' },
      what: 'browser sign-in did not complete',
      fix: 'verification prompt',
    },
    { reason: { code: 'REGISTRY_VERIFICATION_FAILED', status: 401 }, what: 'could not verify', fix: 'sign in again' },
    {
      reason: { code: 'ONBOARDING_REQUIRED', onboardingUrl: 'https://app.example/auth/onboarding' },
      what: 'account setup',
      fix: 'https://app.example/auth/onboarding',
    },
    { reason: { code: 'IDENTITY_MISMATCH' }, what: 'no longer matches', fix: 'intended account' },
    { reason: { code: 'SESSION_CHANGED' }, what: 'sign-in changed', fix: 'retry the command' },
    { reason: { code: 'REAUTHENTICATION_REQUIRED' }, what: 'sign-in has expired', fix: 'browser again' },
    {
      reason: { code: 'REFRESH_UNAVAILABLE', reason: 'stale-window' },
      what: 'could not be renewed',
      fix: 'restore access',
    },
    { reason: { code: 'LOGOUT_UNAVAILABLE', status: 503 }, what: 'could not confirm sign-out', fix: 'local-only' },
    { reason: { code: 'CANCELLED' }, what: 'was cancelled', fix: 'retry the command' },
    { reason: { code: 'UNEXPECTED_FAILURE' }, what: 'failed unexpectedly', fix: 'report a bug' },
  ] satisfies ReadonlyArray<{ reason: RegistrySessionFailure; what: string; fix: string }>

  test('carries all 15 typed local failures through RegistryResult with fixed actionable guidance', () => {
    expect(cases).toHaveLength(15)
    for (const entry of cases) {
      const result: RegistryResult<string> = {
        ok: false,
        error: { code: 'AUTHENTICATION_ERROR', reason: entry.reason },
      }
      if (result.ok) expect.unreachable()
      const rendered = translateEngineRegistryError(result.error)
      expect(rendered.what).toContain(entry.what)
      expect(rendered.fix).toContain(entry.fix)
      expect(rendered.detail).toBeUndefined()
      expect(rendered.docsUrl).toBeUndefined()
      expect(JSON.stringify(rendered)).not.toContain(secret)
      expect(JSON.stringify(rendered)).not.toContain(entry.reason.code)
    }
  })

  test('never renders an unvalidated onboarding URL or nested local diagnostics', () => {
    for (const onboardingUrl of [
      `javascript:${secret}`,
      `https://app.example/auth/onboarding?token=${secret}`,
      `https://user:${secret}@app.example/auth/onboarding`,
      `https://app.example/auth/onboarding\n${secret}`,
    ]) {
      const rendered = translateEngineRegistryError({
        code: 'AUTHENTICATION_ERROR',
        reason: { code: 'ONBOARDING_REQUIRED', onboardingUrl },
      })
      expect(rendered.fix).toContain('registry onboarding page')
      expect(JSON.stringify(rendered)).not.toContain(secret)
      expect(rendered.docsUrl).toBeUndefined()
    }

    const transient = translateEngineRegistryError({
      code: 'AUTHENTICATION_ERROR',
      reason: { code: 'REFRESH_UNAVAILABLE', reason: 'transient' },
    })
    expect(transient.fix).toContain('retry the command')
    expect(transient.fix).not.toContain('transient')
  })
})
