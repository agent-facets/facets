import { describe, expect, test } from 'bun:test'
import { parseFacetName, parseSlug, validateFacetName } from '@agent-facets/protocol'

// --- parseSlug: the atomic identity grammar ---

describe('parseSlug — valid slugs', () => {
  test.each(['a', 'cowsay', 'viper-plans', 'code-review', 'x1', 'a-b-c', 'web3', 'foo--bar'])('accepts %p', (value) => {
    const result = parseSlug(value)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.value).toBe(value)
  })
})

describe('parseSlug — invalid slugs', () => {
  test.each([
    '', // empty
    'Cowsay', // uppercase
    'COWSAY',
    'cow_say', // underscore
    '1cow', // leading digit
    '-cow', // leading hyphen
    'cow-', // trailing hyphen
    'cow say', // space
    '@cow', // at-sign
    'cow/say', // slash
    'cow.say', // dot
    '..',
    'café', // non-ascii
  ])('rejects %p', (value) => {
    const result = parseSlug(value)
    expect(result.ok).toBe(false)
  })
})

// --- parseFacetName: unscoped + scoped composition ---

describe('parseFacetName — valid unscoped identities', () => {
  test.each(['cowsay', 'viper-plans', 'a', 'code-review'])('accepts %p as unscoped', (value) => {
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
    ['@a/b', 'a', 'b'],
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
    '@julian', // missing slash
    '@julian/', // empty name
    '@/cowsay', // empty scope
    '@julian/cow/say', // extra path depth
    '@julian/cow_say', // underscore in name
    '@Julian/cowsay', // uppercase scope
    '@julian/Cowsay', // uppercase name
    '@julian/cow-', // trailing hyphen in name
    '@julian/cowsay@', // trailing at-sign (not a valid name segment)
  ])('rejects %p', (value) => {
    const result = parseFacetName(value)
    expect(result.ok).toBe(false)
  })
})

describe('parseFacetName — invalid unscoped / legacy-ish identities', () => {
  test.each([
    '', // empty
    'Cowsay', // uppercase
    'cow_say', // underscore
    '../cowsay', // traversal
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
