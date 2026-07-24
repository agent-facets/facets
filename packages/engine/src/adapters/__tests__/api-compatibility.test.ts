import { describe, expect, test } from 'bun:test'
import { ADAPTER_API_VERSION } from '@agent-facets/adapter'
import { classifyApiDeclaration, isWellFormedAdapterApi, SUPPORTED_ADAPTER_APIS } from '../api-compatibility.ts'

describe('SUPPORTED_ADAPTER_APIS', () => {
  test('is exactly the SDK canonical version', () => {
    expect(SUPPORTED_ADAPTER_APIS).toEqual([ADAPTER_API_VERSION])
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
  test('classifies the supported canonical version as supported', () => {
    expect(classifyApiDeclaration(ADAPTER_API_VERSION)).toEqual({ kind: 'supported', api: ADAPTER_API_VERSION })
  })

  test.each(['9.9', '1.0', '0.0'])('classifies well-formed but unknown %s as unsupported', (value) => {
    expect(classifyApiDeclaration(value)).toEqual({ kind: 'unsupported', api: value })
  })

  test('the superseded positional identifier 0.0 is unsupported by a 0.1-only CLI', () => {
    // '0.0' is numerically adjacent to '0.1' but names the earlier
    // positional contract — a different, unsupported wire contract.
    const result = classifyApiDeclaration('0.0')
    expect(result.kind).toBe('unsupported')
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
