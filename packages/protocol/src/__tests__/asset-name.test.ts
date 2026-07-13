import { describe, expect, test } from 'bun:test'
import { parseAssetName, parseAssetNameSegment } from '../schemas/asset-name.ts'

// A segment of exactly the maximum permitted length (64) and one over (65).
const MAX_SEGMENT = 'a'.repeat(64)
const OVER_MAX_SEGMENT = 'a'.repeat(65)

describe('parseAssetNameSegment — Agent Skills grammar', () => {
  // Accept cases: the agentskills.io spec examples plus the deliberate
  // divergences from parseSlug (single-char, digit-start).
  test.each(['pdf-processing', 'data-analysis', 'code-review', 'a', '2fa', 'x1', MAX_SEGMENT])('accepts %p', (name) => {
    expect(parseAssetNameSegment(name)).toEqual({ ok: true, value: name })
  })

  test.each([
    ['', 'must not be empty'],
    [OVER_MAX_SEGMENT, 'must be at most 64 characters'],
    ['-pdf', 'must not start with a hyphen'],
    ['pdf-', 'must not end with a hyphen'],
    ['pdf--processing', 'must not contain consecutive hyphens'],
    ['PDF-Processing', 'must contain only lowercase ASCII letters, digits, and hyphens'],
    ['MySkill', 'must contain only lowercase ASCII letters, digits, and hyphens'],
    ['foo_bar', 'must contain only lowercase ASCII letters, digits, and hyphens'],
    ['cow say', 'must contain only lowercase ASCII letters, digits, and hyphens'],
    ['a/b', 'must contain only lowercase ASCII letters, digits, and hyphens'],
  ])('rejects %p with reason', (name, reason) => {
    const result = parseAssetNameSegment(name)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe(reason)
  })
})

describe('parseAssetName — full (possibly namespaced) name', () => {
  test.each(['pdf-processing', 'a', '2fa', 'viper-plans/planning', 'viper-plans/review/deep'])('accepts %p', (name) => {
    expect(parseAssetName(name)).toEqual({ ok: true, value: name })
  })

  test('rejects an empty name', () => {
    const result = parseAssetName('')
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('must not be empty')
  })

  // Path-safety edges the grammar subsumes: empty segments (leading/trailing/
  // double slash), dot segments, and uppercase/underscore segments.
  test.each(['a//b', './x', '../x', 'a/', '/a'])('rejects %p (empty or dot segment)', (name) => {
    expect(parseAssetName(name).ok).toBe(false)
  })

  test('reason names the offending segment for a multi-segment name', () => {
    const result = parseAssetName('viper-plans/Bad_Name')
    if (result.ok) expect.unreachable()
    expect(result.reason).toContain('segment "Bad_Name"')
  })

  test('rejects a backslash (Windows path separator) within a segment', () => {
    const result = parseAssetName('a\\b')
    if (result.ok) expect.unreachable()
    expect(result.reason).toContain('lowercase ASCII letters')
  })

  test('accepts a segment of exactly 64 characters, rejects 65', () => {
    expect(parseAssetName(MAX_SEGMENT).ok).toBe(true)
    expect(parseAssetName(OVER_MAX_SEGMENT).ok).toBe(false)
  })
})
