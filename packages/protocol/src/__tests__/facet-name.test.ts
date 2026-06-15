import { describe, expect, test } from 'bun:test'
import { parseFacetName, parseSlug, validateFacetName } from '@agent-facets/protocol'

// --- parseSlug: the atomic identity grammar ---

describe('parseSlug — valid slugs', () => {
  test.each([
    'ab',
    'cowsay',
    'julian',
    'admin-tester',
    'apple-b34r',
    'f-o-s-s-o',
    'viper-plans',
    'code-review',
    'x1',
    'a-b-c',
    'web3',
    'a'.repeat(64), // maximum length
  ])('accepts %p', (value) => {
    const result = parseSlug(value)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.value).toBe(value)
  })
})

describe('parseSlug — invalid slugs', () => {
  test.each([
    '', // empty
    'a', // single character
    'z', // single character
    'A', // single uppercase character
    'Cowsay', // uppercase
    'COWSAY',
    'cow_say', // underscore
    'abc_def', // underscore
    '1abc', // leading digit
    '1cow', // leading digit
    '-abc', // leading hyphen
    '-cow', // leading hyphen
    'abc-', // trailing hyphen
    'cow-', // trailing hyphen
    'abc--def', // consecutive hyphens
    'foo--bar', // consecutive hyphens
    'abc def', // space
    'cow say', // space
    '@cow', // at-sign
    'cow/say', // slash
    'abc.def', // dot
    'cow.say', // dot
    'a+b', // plus sign
    'a~b', // tilde
    'a😀b', // emoji
    '..',
    'café', // non-ascii
    'éclair', // non-ascii
    'gооgle', // Cyrillic homoglyphs
    'a'.repeat(65), // exceeds maximum length
  ])('rejects %p', (value) => {
    const result = parseSlug(value)
    expect(result.ok).toBe(false)
  })
})

// --- parseFacetName: unscoped + scoped composition ---

describe('parseFacetName — valid unscoped identities', () => {
  test.each(['cowsay', 'viper-plans', 'ab', 'code-review'])('accepts %p as unscoped', (value) => {
    const result = parseFacetName(value)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.value.kind).toBe('unscoped')
    expect(result.canonical).toBe(value)
    if (result.value.kind !== 'unscoped') expect.unreachable()
    expect(result.value.name).toBe(value)
  })
})

describe('parseFacetName — valid scoped identities', () => {
  test.each([
    ['@julian/cowsay', 'julian', 'cowsay'],
    ['@acme/deploy-tools', 'acme', 'deploy-tools'],
    ['@ab/cd', 'ab', 'cd'],
  ])('accepts %p', (value, scope, name) => {
    const result = parseFacetName(value)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    if (result.value.kind !== 'scoped') expect.unreachable()
    expect(result.value.scope).toBe(scope)
    expect(result.value.name).toBe(name)
    expect(result.canonical).toBe(value)
  })
})

describe('parseFacetName — invalid scoped identities', () => {
  // Cases drawn from protocol__schemas/spec.md scenario "rejects a malformed
  // facet identity" plus the design.md risk list.
  test.each([
    '@scope', // missing slash
    '@julian', // missing slash
    '@/name', // empty scope
    '@/cowsay', // empty scope
    '@scope/', // empty name
    '@julian/', // empty name
    '@scope/name/extra', // extra path depth
    '@julian/cow/say', // extra path depth
    '@julian/cow_say', // underscore in name
    '@Julian/cowsay', // uppercase scope
    '@julian/Cowsay', // uppercase name
    '@julian/cow-', // trailing hyphen in name
    '@julian/co--w', // consecutive hyphens in name
    '@a/cowsay', // single-character scope
    '@julian/a', // single-character name
    '@julian/cowsay@', // trailing at-sign (not a valid name segment)
  ])('rejects %p', (value) => {
    const result = parseFacetName(value)
    expect(result.ok).toBe(false)
  })
})

describe('parseFacetName — invalid unscoped / legacy-ish identities', () => {
  test.each([
    '', // empty
    'a', // single character
    'Cowsay', // uppercase
    'cow_say', // underscore
    'co--wsay', // consecutive hyphens
    '../cowsay', // traversal
    'scope/name', // legacy scoped syntax without at-prefix
    'cow/say', // bare slash (not scoped)
    'cow say', // space
    'cow-', // trailing hyphen
    '-cow', // leading hyphen
  ])('rejects %p', (value) => {
    const result = parseFacetName(value)
    expect(result.ok).toBe(false)
  })
})

// --- validateFacetName: thin boolean wrapper ---

describe('validateFacetName', () => {
  test('accepts a valid unscoped name', () => {
    expect(validateFacetName('cowsay')).toEqual({ ok: true })
  })

  test('accepts a valid scoped name', () => {
    expect(validateFacetName('@julian/cowsay')).toEqual({ ok: true })
  })

  test('rejects a malformed name with a reason', () => {
    const result = validateFacetName('@julian')
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason.length).toBeGreaterThan(0)
  })
})
