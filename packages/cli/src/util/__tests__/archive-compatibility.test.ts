import { describe, expect, test } from 'bun:test'
import { archiveCompatibilityGuidance } from '../archive-compatibility.ts'

describe('archiveCompatibilityGuidance', () => {
  test('names the minimum supporting release for a known newer format', () => {
    const g = archiveCompatibilityGuidance('0.2', ['0.1'])
    expect(g.what).toContain('archive format 0.2')
    expect(g.detail).toContain('supported archive formats: 0.1')
    // Known format → concrete minimum release, not a bare "update to latest".
    expect(g.fix).toContain('0.2.0 or later')
  })

  test('advises updating to latest for an unknown future format without inventing a minimum', () => {
    const g = archiveCompatibilityGuidance('0.9', ['0.1', '0.2'])
    expect(g.what).toContain('archive format 0.9')
    expect(g.fix).toContain('latest release')
    // No fabricated minimum version for a format this CLI cannot know about.
    expect(g.fix).not.toMatch(/\d+\.\d+\.\d+ or later/)
  })

  test('handles a missing/unparseable declared format', () => {
    const g = archiveCompatibilityGuidance(undefined, ['0.1', '0.2'])
    expect(g.what).toContain('does not recognize')
    expect(g.detail).toContain('0.1, 0.2')
    expect(g.fix).toContain('latest release')
  })
})
