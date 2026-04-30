import { describe, expect, test } from 'bun:test'
import { verifyGitOneCheck, verifyHash, verifyRegistryThreeCheck } from '../integrity/index.ts'

const HASH_A = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const HASH_B = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const HASH_C = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
const HASH_D = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

describe('verifyHash', () => {
  test('returns ok on equality', () => {
    const result = verifyHash('viper-plans', 'A', HASH_A, HASH_A)
    expect(result.ok).toBe(true)
  })

  test('returns structured failure on mismatch', () => {
    const result = verifyHash('viper-plans', 'A', HASH_A, HASH_B)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({
      facet: 'viper-plans',
      check: 'A',
      expected: HASH_A,
      observed: HASH_B,
    })
  })

  test('failure carries the check label verbatim', () => {
    const result = verifyHash('p', 'lockfile', HASH_A, HASH_B)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.check).toBe('lockfile')
  })
})

describe('verifyRegistryThreeCheck — all matches', () => {
  test('cache hit, lockfile-pinned, all match', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_A,
      computedIntegrity: HASH_A,
      cachedIntegrity: HASH_A,
      lockfileIntegrity: HASH_A,
    })
    expect(result.ok).toBe(true)
  })

  test('cache hit, no lockfile pin, all match', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_A,
      computedIntegrity: HASH_A,
      cachedIntegrity: HASH_A,
    })
    expect(result.ok).toBe(true)
  })

  test('cache miss, lockfile-pinned, all match', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_A,
      computedIntegrity: HASH_A,
      lockfileIntegrity: HASH_A,
    })
    expect(result.ok).toBe(true)
  })

  test('cache miss, no lockfile pin, B and C both match', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_A,
      computedIntegrity: HASH_A,
    })
    expect(result.ok).toBe(true)
  })
})

describe('verifyRegistryThreeCheck — lockfile failure (highest priority)', () => {
  test('lockfile mismatch fires before any other check', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_B, // registry now claims B
      archiveIntegrity: HASH_B,
      computedIntegrity: HASH_B,
      cachedIntegrity: HASH_B, // even cache agrees with registry
      lockfileIntegrity: HASH_A, // but the lockfile pinned A
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({
      facet: 'p',
      check: 'lockfile',
      expected: HASH_A,
      observed: HASH_B,
    })
  })
})

describe('verifyRegistryThreeCheck — Check A (cache vs metadata)', () => {
  test('cache hit, expected mismatches cached, fires A', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_B, // registry says B
      archiveIntegrity: HASH_C, // never consulted
      computedIntegrity: HASH_D, // never consulted
      cachedIntegrity: HASH_A, // cache has A
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.check).toBe('A')
    expect(result.failure.expected).toBe(HASH_B)
    expect(result.failure.observed).toBe(HASH_A)
  })

  test('cache hit with mismatch skips B and C entirely', () => {
    // The result must reflect Check A regardless of what archive/computed say.
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_C, // would fail B against expected
      computedIntegrity: HASH_D, // would fail C against archive
      cachedIntegrity: HASH_B, // fails A against expected
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.check).toBe('A')
  })

  test('cache hit with match returns ok and skips B and C', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_C, // would fail B
      computedIntegrity: HASH_D, // would fail C
      cachedIntegrity: HASH_A,
    })
    expect(result.ok).toBe(true)
  })
})

describe('verifyRegistryThreeCheck — Check B (archive manifest vs metadata)', () => {
  test('cache miss, B mismatch fires before C', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_B, // mismatches expected → B fails
      computedIntegrity: HASH_C, // would also fail C, but we never get there
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.check).toBe('B')
    expect(result.failure.expected).toBe(HASH_A)
    expect(result.failure.observed).toBe(HASH_B)
  })
})

describe('verifyRegistryThreeCheck — Check C (computed vs archive manifest)', () => {
  test('cache miss, B passes, C mismatch', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_A, // B passes
      computedIntegrity: HASH_B, // C fails against archive
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.check).toBe('C')
    expect(result.failure.expected).toBe(HASH_A)
    expect(result.failure.observed).toBe(HASH_B)
  })

  test('lockfile passes, B passes, C fails', () => {
    const result = verifyRegistryThreeCheck({
      facet: 'p',
      expectedIntegrity: HASH_A,
      archiveIntegrity: HASH_A,
      computedIntegrity: HASH_C,
      lockfileIntegrity: HASH_A,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.check).toBe('C')
  })
})

describe('verifyGitOneCheck', () => {
  test('match returns ok', () => {
    const result = verifyGitOneCheck({
      facet: 'p',
      computedIntegrity: HASH_A,
      lockfileIntegrity: HASH_A,
    })
    expect(result.ok).toBe(true)
  })

  test('mismatch fires git failure', () => {
    const result = verifyGitOneCheck({
      facet: 'p',
      computedIntegrity: HASH_B,
      lockfileIntegrity: HASH_A,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({
      facet: 'p',
      check: 'git',
      expected: HASH_A,
      observed: HASH_B,
    })
  })
})
