import { describe, expect, test } from 'bun:test'
import type { CollisionResolution, CollisionResolutionRequest } from '@agent-facets/engine'
import type { FacetContribution } from '@agent-facets/protocol'
import { planMaterialization } from '@agent-facets/protocol'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { CollisionWorkspace } from '../workspace.tsx'

const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  enter: '\r',
  escape: '\u001B',
  ctrlC: '\u0003',
} as const

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

function skill(facet: string, ...names: string[]): FacetContribution {
  return { facet, assets: names.map((name) => ({ scope: 'project', type: 'skill', name })) }
}

function requestFor(contributions: FacetContribution[]): CollisionResolutionRequest {
  const planned = planMaterialization(contributions)
  if (planned.ok) expect.unreachable()
  if (planned.reason !== 'collision') expect.unreachable()
  return { groups: planned.groups, contributions, staleOverrides: planned.staleOverrides }
}

function mount(contributions: FacetContribution[]) {
  const resolutions: CollisionResolution[] = []
  const request = requestFor(contributions)
  const app = render(
    createElement(CollisionWorkspace, {
      request,
      onComplete: (resolution: CollisionResolution) => resolutions.push(resolution),
    }),
  )
  return { app, resolutions, request }
}

async function press(app: ReturnType<typeof render>, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    app.stdin.write(key)
    await nextTick()
  }
}

const TWO_WAY = [skill('alpha', 'review'), skill('beta', 'review')]

describe('CollisionWorkspace — overview', () => {
  test('shows every group, every claimant, and that nothing is written yet', async () => {
    const { app } = mount([skill('alpha', 'review', 'deploy'), skill('beta', 'review', 'deploy')])
    await nextTick()

    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('review')
    expect(frame).toContain('deploy')
    expect(frame).toContain('alpha')
    expect(frame).toContain('beta')
    expect(frame).toContain('nothing has been written yet')
    app.unmount()
  })

  test('confirm is refused while any group is unresolved', async () => {
    const { app, resolutions } = mount(TWO_WAY)
    await nextTick()

    expect(app.lastFrame() ?? '').toContain('resolve every group first')

    // Walk to the confirm row and press it anyway.
    await press(app, KEY.down, KEY.enter)
    expect(resolutions).toHaveLength(0)
    app.unmount()
  })

  test('escape cancels without submitting a draft', async () => {
    const { app, resolutions } = mount(TWO_WAY)
    await nextTick()
    await press(app, KEY.escape)

    expect(resolutions).toEqual([{ kind: 'cancelled' }])
    app.unmount()
  })

  test('ctrl-c cancels', async () => {
    // Ink's own ctrl-C handling is disabled by the commands precisely so
    // this path runs: it is the only one that settles the engine's
    // pending promise and lets it release the project lock.
    const { app, resolutions } = mount(TWO_WAY)
    await nextTick()
    await press(app, KEY.ctrlC)

    expect(resolutions).toEqual([{ kind: 'cancelled' }])
    app.unmount()
  })
})

describe('CollisionWorkspace — resolving a group', () => {
  test('omitting every claimant resolves the group and confirms', async () => {
    const { app, resolutions } = mount(TWO_WAY)
    await nextTick()

    // Open the group, then put both claimants on Omit. Arrows only
    // move the cursor; Enter applies.
    await press(app, KEY.enter, KEY.right, KEY.right, KEY.enter, KEY.down, KEY.right, KEY.right, KEY.enter)
    expect(app.lastFrame() ?? '').toContain('not materialized')

    // Back to the overview, onto the confirm row, submit.
    await press(app, KEY.escape, KEY.down, KEY.enter)

    expect(resolutions).toHaveLength(1)
    const resolution = resolutions[0]
    if (resolution?.kind !== 'resolved') expect.unreachable()
    expect(resolution.overrides.alpha).toEqual({ skills: { review: { kind: 'omitted' } } })
    expect(resolution.overrides.beta).toEqual({ skills: { review: { kind: 'omitted' } } })
    app.unmount()
  })

  test('choosing Alias opens an editor without committing a choice yet', async () => {
    const { app } = mount(TWO_WAY)
    await nextTick()
    await press(app, KEY.enter, KEY.right, KEY.enter)

    // An alias is not a decision until it has a name, so nothing is
    // recorded until the editor is submitted.
    expect(app.lastFrame() ?? '').toContain('Enter')
    expect(app.lastFrame() ?? '').toContain('apply')
    app.unmount()
  })

  test('an invalid alias explains itself and refuses to apply', async () => {
    const { app, resolutions } = mount(TWO_WAY)
    await nextTick()
    await press(app, KEY.enter, KEY.right, KEY.enter)

    // Clear the seeded value and type something illegal.
    await press(app, ...'\u007f'.repeat(10).split(''), 'R')
    const frame = app.lastFrame() ?? ''
    expect(frame.toLowerCase()).toContain('lowercase')

    // Enter is inert while invalid.
    await press(app, KEY.enter)
    expect(app.lastFrame() ?? '').toContain('lowercase')
    expect(resolutions).toHaveLength(0)
    app.unmount()
  })

  test('a valid alias resolves the group and can be confirmed', async () => {
    const { app, resolutions } = mount(TWO_WAY)
    await nextTick()

    await press(app, KEY.enter, KEY.right, KEY.enter)
    await press(app, ...'\u007f'.repeat(10).split(''))
    await press(app, ...'vendor-review'.split(''))
    await press(app, KEY.enter)

    expect(app.lastFrame() ?? '').toContain('vendor-review')

    await press(app, KEY.escape, KEY.down, KEY.enter)

    const resolution = resolutions[0]
    if (resolution?.kind !== 'resolved') expect.unreachable()
    expect(resolution.overrides.alpha).toEqual({ skills: { review: { kind: 'aliased', as: 'vendor-review' } } })
    // The untouched claimant keeps its authored name, recorded by absence.
    expect(resolution.overrides.beta).toBeUndefined()
    app.unmount()
  })

  test('escape abandons an alias edit without changing the choice', async () => {
    const { app } = mount(TWO_WAY)
    await nextTick()

    await press(app, KEY.enter, KEY.right, KEY.enter)
    await press(app, ...'zzz'.split(''))
    await press(app, KEY.escape)

    const frame = app.lastFrame() ?? ''
    expect(frame).not.toContain('zzz')
    // Still the group view, still on Keep.
    expect(frame).toContain('(Keep)')
    app.unmount()
  })
})

describe('CollisionWorkspace — conflicts the user creates', () => {
  test('aliasing onto another asset marks both sides and keeps confirm shut', async () => {
    const { app, resolutions } = mount([skill('alpha', 'review'), skill('beta', 'review'), skill('gamma', 'audit')])
    await nextTick()

    await press(app, KEY.enter, KEY.right, KEY.enter)
    await press(app, ...'\u007f'.repeat(10).split(''))
    await press(app, ...'audit'.split(''))
    await press(app, KEY.enter)

    const frame = app.lastFrame() ?? ''
    // The dragged-in asset is now on screen, in the same group, so the
    // user can fix either side without hunting for the other.
    expect(frame).toContain('gamma')
    expect(frame).toContain('conflict')
    expect(frame).toContain('still contested with')

    await press(app, KEY.escape, KEY.down, KEY.enter)
    expect(resolutions).toHaveLength(0)
    app.unmount()
  })
})
