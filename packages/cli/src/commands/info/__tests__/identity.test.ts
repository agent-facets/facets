import { describe, expect, test } from 'bun:test'
import { identitySegments } from '../identity.ts'

describe('identitySegments', () => {
  const user = { owner: { kind: 'user', username: 'julian' } as const, publisher: 'julian' }

  test('shows the free-text author and the verified publisher apart', () => {
    expect(identitySegments('Julian Smith', user)).toEqual(['by "Julian Smith"', 'published by @julian'])
  })

  test('an organization owner leads the verified segment', () => {
    expect(identitySegments(undefined, { owner: { kind: 'org', slug: 'acme' }, publisher: 'julian' })).toEqual([
      '@acme, published by @julian',
    ])
  })

  test('a self-declared @ author stays in the author segment', () => {
    expect(
      identitySegments('@anthropic', { owner: { kind: 'user', username: 'mallory' }, publisher: 'mallory' }),
    ).toEqual(['by "@anthropic"', 'published by @mallory'])
  })

  test('without the registry only the author shows', () => {
    expect(identitySegments('Julian Smith', undefined)).toEqual(['by "Julian Smith"'])
  })

  test.each([
    [
      'a forged publisher segment',
      'Mallory · @anthropic, published by @anthropic',
      'by "Mallory · @anthropic, published by @anthropic"',
    ],
    [
      'a quote that tries to close the author',
      'x" · published by @anthropic · "y',
      'by "x\\" · published by @anthropic · \\"y"',
    ],
    ['a line break', 'Mallory\npublished by @anthropic', 'by "Mallory published by @anthropic"'],
  ])('%s stays inside the quoted author', (_label, author, expected) => {
    expect(identitySegments(author, undefined)).toEqual([expected])
  })

  test('a malformed publisher is dropped rather than shown as verified', () => {
    expect(identitySegments(undefined, { ...user, publisher: 'julian\u001b[2J' })).toEqual([])
  })
})
