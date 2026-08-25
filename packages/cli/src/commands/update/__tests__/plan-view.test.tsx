import { describe, expect, test } from 'bun:test'
import { validateFacetUpdateSelections } from '@agent-facets/engine'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { stripTerminalControls, visibleTerminalText } from '../../../__tests__/helpers/terminal-output.ts'
import { UpdatePlanView } from '../../../tui/views/update/plan-view.tsx'
import { buildPreview } from '../preview.ts'
import { defaultSelections, type UpdateMode } from '../selection.ts'
import { candidate, current, unsupported } from './fixtures.ts'

const BOUNDED = candidate({
  name: 'alpha',
  source: '1.*',
  current: '1.2.0',
  target: '1.8.0',
  latest: '2.0.0',
  advancing: 'range-and-latest',
})

const PINNED = candidate({
  name: 'beta',
  source: '1.2.0',
  current: '1.2.0',
  target: '1.2.0',
  latest: '3.4.1',
  advancing: 'latest-only',
})

const MINOR = candidate({
  name: 'gamma',
  source: '1.2.*',
  current: '1.2.0',
  target: '1.2.9',
  latest: '3.4.1',
  advancing: 'range-and-latest',
})

/** Render exactly what the command renders: engine-derived preview data. */
function frameFor(plan: Parameters<typeof buildPreview>[0], mode: UpdateMode): string {
  const selections = defaultSelections(plan, mode)
  const validated = validateFacetUpdateSelections(plan, selections)
  const preview = buildPreview(plan, selections, validated.ok ? validated.selections : [])
  const instance = render(createElement(UpdatePlanView, { plan, ...preview }))
  const frame = instance.lastFrame() ?? ''
  instance.unmount()
  return frame
}

describe('UpdatePlanView', () => {
  test('shows the declared range, current, target, and latest for each facet', () => {
    const frame = visibleTerminalText(frameFor([BOUNDED], 'range'))
    expect(frame).toContain('alpha')
    expect(frame).toContain('1.*')
    expect(frame).toContain('1.2.0')
    expect(frame).toContain('1.8.0')
    expect(frame).toContain('2.0.0')
  })

  // The row that explains itself: nothing is selected, and both versions
  // are on screen so the user can see that only Latest is ahead.
  test('shows a facet whose range permits nothing, unselected', () => {
    const frame = stripTerminalControls(frameFor([PINNED], 'range'))
    expect(frame).toMatch(/beta.*1\.2\.0.*3\.4\.1/)
    expect(frame).not.toMatch(/▸\s*beta/)
  })

  test('marks the rows a run would move', () => {
    const frame = stripTerminalControls(frameFor([BOUNDED, PINNED], 'range'))
    expect(frame).toMatch(/▸\s*alpha/)
    expect(frame).not.toMatch(/▸\s*beta/)
  })

  test('git and local facets are named as unchecked, not counted as current', () => {
    const frame = visibleTerminalText(frameFor([BOUNDED, unsupported('delta', 'github:a/b', 'git')], 'range'))
    expect(frame).toContain('delta — git source (github:a/b); not checked for updates')
  })

  test('a project of only current facets still lists them', () => {
    const frame = visibleTerminalText(frameFor([current({ name: 'gamma', source: '*', version: '4.0.0' })], 'range'))
    expect(frame).toContain('gamma')
    expect(frame).toContain('4.0.0')
  })
})

describe('UpdatePlanView — manifest rewrites', () => {
  // Every rewrite shown here comes from the engine's own derivation, so
  // the preview cannot describe an edit the write would not make.
  test('latest mode previews the smallest edit that admits the new version', () => {
    const frame = visibleTerminalText(frameFor([BOUNDED, PINNED, MINOR], 'latest'))
    expect(frame).toContain('facets.json 1.* → 2.*')
    expect(frame).toContain('facets.json 1.2.0 → 3.4.1')
    expect(frame).toContain('facets.json 1.2.* → 3.4.*')
  })

  test('a range selection rewrites nothing, so nothing is shown', () => {
    const frame = visibleTerminalText(frameFor([BOUNDED], 'range'))
    expect(frame).not.toContain('facets.json')
  })

  test('a floating specifier survives a latest selection unchanged', () => {
    const floating = candidate({
      name: 'epsilon',
      source: 'latest',
      current: '1.0.0',
      target: '2.0.0',
      latest: '2.0.0',
      advancing: 'range-and-latest',
    })
    expect(visibleTerminalText(frameFor([floating], 'latest'))).not.toContain('facets.json')
  })
})
