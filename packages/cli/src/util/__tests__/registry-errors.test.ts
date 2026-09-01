import { describe, expect, test } from 'bun:test'
import type { RegistryError } from '@agent-facets/engine'
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
