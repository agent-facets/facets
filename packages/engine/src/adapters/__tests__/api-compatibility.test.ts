import { describe, expect, test } from 'bun:test'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import { classifyApiDeclaration, isWellFormedAdapterApi, SUPPORTED_ADAPTER_APIS } from '../api-compatibility.ts'

describe('SUPPORTED_ADAPTER_APIS', () => {
  test('is exactly the planning contract', () => {
    expect([...SUPPORTED_ADAPTER_APIS]).toEqual([ADAPTER_API_VERSION])
  })

  test.each(['0.0', '0.1', '0.2'])('excludes the superseded contract %s', (value) => {
    // Named as literals on purpose: none of these has a constant anywhere in
    // the monorepo, and this asserts none of them acquires one by way of the
    // set. Under each of them the adapter performed its own writes and owned
    // its own rollback, which is exactly what this CLI can no longer offer.
    expect(SUPPORTED_ADAPTER_APIS).not.toContain(value)
  })
})

describe('isWellFormedAdapterApi', () => {
  test.each(['0.0', '0.1', '1.0', '10.25', '999.999'])('accepts canonical MAJOR.MINOR %s', (value) => {
    expect(isWellFormedAdapterApi(value)).toBe(true)
  })

  test.each([
    '0.0.1', // patch component
    '0', // no minor
    '0.', // dangling separator
    '.0', // missing major
    '+0.0', // sign
    '-0.0', // sign
    '0.-1', // signed minor
    '00.1', // leading zero
    '0.00', // leading zero
    '01.2', // leading zero
    '0.0-beta', // suffix
    '0.0+build', // build metadata
    'v0.0', // prefix
    ' 0.0', // whitespace
    '0.0 ', // whitespace
    '0 .0', // inner whitespace
    '', // empty
    'latest', // tag
  ])('rejects malformed %j', (value) => {
    expect(isWellFormedAdapterApi(value)).toBe(false)
  })
})

describe('classifyApiDeclaration', () => {
  test('classifies the canonical version as supported', () => {
    expect(classifyApiDeclaration(ADAPTER_API_VERSION)).toEqual({ kind: 'supported', api: ADAPTER_API_VERSION })
  })

  test.each(['9.9', '1.0', '0.0', '0.1', '0.2'])('classifies well-formed but unknown %s as unsupported', (value) => {
    expect(classifyApiDeclaration(value)).toEqual({ kind: 'unsupported', api: value })
  })

  test('numeric proximity to the supported token confers nothing', () => {
    // '0.2' is one step below the supported contract and names the last one
    // in which the adapter wrote files itself. Adjacency must not drag it in.
    expect(classifyApiDeclaration('0.2').kind).toBe('unsupported')
  })

  test.each(['0.0.1', '+0.0', '00.1', '0.0-beta', ''])('classifies invalid string %j as malformed', (value) => {
    expect(classifyApiDeclaration(value)).toEqual({ kind: 'malformed', found: value })
  })

  // Each case wrapped in an argument list so array values aren't spread.
  test.each([[42], [true], [{}], [[]]])('classifies non-string %j as malformed', (value) => {
    const result = classifyApiDeclaration(value)
    expect(result.kind).toBe('malformed')
  })

  test('classifies a null-prototype object as malformed instead of throwing', () => {
    expect(classifyApiDeclaration(Object.create(null))).toEqual({ kind: 'malformed', found: '<uncoercible>' })
  })

  test('classifies an object with a throwing Symbol.toPrimitive as malformed instead of throwing', () => {
    const hostile = {
      [Symbol.toPrimitive]() {
        throw new Error('refuses coercion')
      },
    }
    expect(classifyApiDeclaration(hostile)).toEqual({ kind: 'malformed', found: '<uncoercible>' })
  })

  test('classifies undefined as missing', () => {
    expect(classifyApiDeclaration(undefined)).toEqual({ kind: 'missing' })
  })

  test('classifies null as missing', () => {
    expect(classifyApiDeclaration(null)).toEqual({ kind: 'missing' })
  })
})
