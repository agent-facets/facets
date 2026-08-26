import { describe, expect, test } from 'bun:test'
import { classifyNoOp, defaultSelections, describeNoOp, hasSelectableCandidate } from '../selection.ts'
import { candidate, current, unsupported } from './fixtures.ts'

const BOUNDED = candidate({
  name: 'alpha',
  source: '1.*',
  current: '1.2.0',
  target: '1.8.0',
  latest: '2.0.0',
  advancing: 'range-and-latest',
})

// An exact pin: the range cannot move, but a newer release exists.
const PINNED = candidate({
  name: 'beta',
  source: '1.2.0',
  current: '1.2.0',
  target: '1.2.0',
  latest: '3.0.0',
  advancing: 'latest-only',
})

describe('defaultSelections', () => {
  test('plain update takes the range target of every advancing candidate', () => {
    expect(defaultSelections([BOUNDED, PINNED], 'range')).toEqual([{ facetName: 'alpha', choice: 'range' }])
  })

  test('latest mode takes the latest release, including across a bounded range', () => {
    expect(defaultSelections([BOUNDED, PINNED], 'latest')).toEqual([
      { facetName: 'alpha', choice: 'latest' },
      { facetName: 'beta', choice: 'latest' },
    ])
  })

  test('current and unsupported rows are never selected', () => {
    const plan = [current({ name: 'gamma', source: '*', version: '4.0.0' }), unsupported('delta', './local', 'local')]
    expect(defaultSelections(plan, 'range')).toEqual([])
    expect(defaultSelections(plan, 'latest')).toEqual([])
  })
})

describe('hasSelectableCandidate', () => {
  test('a candidate the mode would not select still counts', () => {
    // The whole point: under plain update PINNED contributes no default
    // selection, and it is still a row worth showing.
    expect(defaultSelections([PINNED], 'range')).toEqual([])
    expect(hasSelectableCandidate([PINNED])).toBe(true)
  })

  test('rows with nothing newer do not count', () => {
    expect(hasSelectableCandidate([current({ name: 'gamma', source: '*', version: '4.0.0' })])).toBe(false)
    expect(hasSelectableCandidate([unsupported('delta', './local', 'local')])).toBe(false)
    expect(hasSelectableCandidate([])).toBe(false)
  })

  test('one candidate among unselectable rows is enough', () => {
    const plan = [current({ name: 'gamma', source: '*', version: '4.0.0' }), PINNED]
    expect(hasSelectableCandidate(plan)).toBe(true)
  })
})

describe('classifyNoOp', () => {
  test('work to do is not a no-op', () => {
    expect(classifyNoOp([BOUNDED], 'range', [{ facetName: 'alpha', choice: 'range' }])).toBeNull()
  })

  test('a project with only git and local facets has nothing to check', () => {
    const noOp = classifyNoOp([unsupported('delta', 'github:a/b', 'git')], 'range', [])
    expect(noOp).toEqual({ reason: 'no-registry-facets' })
    expect(describeNoOp({ reason: 'no-registry-facets' })).toContain('No registry facets')
  })

  test('every registry facet current is its own outcome', () => {
    const noOp = classifyNoOp([current({ name: 'gamma', source: '*', version: '4.0.0' })], 'range', [])
    expect(noOp).toEqual({ reason: 'all-current' })
    expect(describeNoOp({ reason: 'all-current' })).toContain('current')
  })

  // The case a single "nothing to update" would hide: there IS something
  // newer, and the user has a flag that would take it.
  test('a blocked range names --latest as the way past it', () => {
    const noOp = classifyNoOp([PINNED], 'range', [])
    expect(noOp).toEqual({ reason: 'ranges-permit-none' })
    const message = describeNoOp({ reason: 'ranges-permit-none' })
    expect(message).toContain('facet update --latest')
  })

  test('latest mode with nothing newer suggests nothing', () => {
    const noOp = classifyNoOp([PINNED], 'latest', [])
    expect(noOp).toEqual({ reason: 'latest-permits-none' })
    expect(describeNoOp({ reason: 'latest-permits-none' })).not.toContain('--latest')
  })
})
