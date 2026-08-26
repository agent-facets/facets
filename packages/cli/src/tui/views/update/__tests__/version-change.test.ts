import { describe, expect, test } from 'bun:test'
import { THEME } from '../../../theme.ts'
import { classifyVersionChange, formatExactVersion, splitAtChange, versionChangeColor } from '../version-change.ts'

function v(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return { major, minor, patch }
}

describe('classifyVersionChange', () => {
  test('names the largest component that moved', () => {
    expect(classifyVersionChange(v('1.2.3'), v('2.0.0'))).toBe('major')
    expect(classifyVersionChange(v('1.2.3'), v('1.3.0'))).toBe('minor')
    expect(classifyVersionChange(v('1.2.3'), v('1.2.4'))).toBe('patch')
    expect(classifyVersionChange(v('1.2.3'), v('1.2.3'))).toBe('none')
  })

  // A major bump is a major bump even when the lower components happen
  // to match, and a minor bump is not downgraded to a patch because the
  // patch also moved.
  test('a larger change wins over a smaller one in the same jump', () => {
    expect(classifyVersionChange(v('1.2.3'), v('2.2.3'))).toBe('major')
    expect(classifyVersionChange(v('1.2.3'), v('1.9.9'))).toBe('minor')
  })

  // Nothing here assumes the second version is newer. The picker only
  // ever shows advancing choices, but the classifier is asked about
  // stationary rows too and must not invent a direction.
  test('a lower version still reports which component differs', () => {
    expect(classifyVersionChange(v('2.0.0'), v('1.0.0'))).toBe('major')
  })
})

describe('splitAtChange', () => {
  test('isolates only the component that moved', () => {
    expect(splitAtChange(v('2.4.16'), v('2.5.10'))).toEqual({ prefix: '2.', changed: '5', rest: '.10' })
    expect(splitAtChange(v('4.2.674'), v('4.2.825'))).toEqual({ prefix: '4.2.', changed: '825', rest: '' })
    expect(splitAtChange(v('0.7.0'), v('1.0.0'))).toEqual({ prefix: '', changed: '1', rest: '.0.0' })
  })

  // The trailing components reset as a consequence of the bump rather
  // than being part of it. Highlighting the `.0` in `1.2.3 -> 1.3.0`
  // would claim the patch moved too.
  test('components after the change are not part of the highlight', () => {
    const { changed, rest } = splitAtChange(v('1.2.3'), v('1.3.0'))
    expect(changed).toBe('3')
    expect(rest).toBe('.0')
  })

  // An unchanged version is all prefix, so a caller renders it with no
  // highlight at all rather than special-casing the equal row.
  test('an unchanged version has nothing to highlight', () => {
    expect(splitAtChange(v('1.2.0'), v('1.2.0'))).toEqual({ prefix: '1.2.0', changed: '', rest: '' })
  })

  test('the three parts always reassemble into the whole version', () => {
    for (const [from, to] of [
      ['1.2.3', '2.0.0'],
      ['1.2.3', '1.3.0'],
      ['1.2.3', '1.2.4'],
      ['1.2.3', '1.2.3'],
      ['2.4.16', '2.5.10'],
    ] as const) {
      const { prefix, changed, rest } = splitAtChange(v(from), v(to))
      expect(prefix + changed + rest).toBe(formatExactVersion(v(to)))
    }
  })
})

describe('versionChangeColor', () => {
  // Mapped onto the existing three-rung scale rather than a new palette:
  // patch is the safe one, major is the one that can break you.
  test('maps change size onto the semantic theme roles', () => {
    expect(versionChangeColor('patch')).toBe(THEME.success)
    expect(versionChangeColor('minor')).toBe(THEME.caution)
    expect(versionChangeColor('major')).toBe(THEME.warning)
  })

  test('an unchanged version gets no colour of its own', () => {
    expect(versionChangeColor('none')).toBeUndefined()
  })

  test('the three sizes are visually distinct from each other', () => {
    const used = [versionChangeColor('patch'), versionChangeColor('minor'), versionChangeColor('major')]
    expect(new Set(used).size).toBe(3)
  })
})
