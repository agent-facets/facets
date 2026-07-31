import { describe, expect, test } from 'bun:test'
import type { CollisionResolutionRequest } from '@agent-facets/engine'
import type { FacetContribution } from '@agent-facets/protocol'
import { planMaterialization } from '@agent-facets/protocol'
import {
  type ClaimantModel,
  createDraft,
  evaluateDraft,
  reviseDraft,
  validateAlias,
  type WorkspaceModel,
} from '../draft.ts'

/**
 * Build the request the engine would hand a resolver: the planner's own
 * collision report over these contributions, never a hand-written one.
 * A fixture that disagreed with the planner would let these tests pass
 * while the real workspace showed something else.
 */
function requestFor(contributions: FacetContribution[]): CollisionResolutionRequest {
  const planned = planMaterialization(contributions)
  if (planned.ok) expect.unreachable()
  if (planned.reason !== 'collision') expect.unreachable()
  return { groups: planned.groups, contributions, staleOverrides: planned.staleOverrides }
}

function skill(facet: string, ...names: string[]): FacetContribution {
  return { facet, assets: names.map((name) => ({ scope: 'project', type: 'skill', name })) }
}

function memberOf(model: WorkspaceModel, facet: string, authoredName: string): ClaimantModel {
  for (const group of model.groups) {
    const found = group.members.find((m) => m.facet === facet && m.authoredName === authoredName)
    if (found) return found
  }
  expect.unreachable()
}

function statusOf(model: WorkspaceModel, facet: string, authoredName: string): string {
  return memberOf(model, facet, authoredName).status
}

const TWO_WAY = [skill('alpha', 'review'), skill('beta', 'review')]

describe('collision draft — initial state', () => {
  test('an inherited collision is unresolved, not a draft conflict', () => {
    const request = requestFor(TWO_WAY)
    const model = evaluateDraft(request, createDraft(request))

    expect(model.confirmable).toBe(false)
    expect(model.groups).toHaveLength(1)
    expect(statusOf(model, 'alpha', 'review')).toBe('unresolved')
    expect(statusOf(model, 'beta', 'review')).toBe('unresolved')
  })

  test('seeds from existing project overrides rather than discarding them', () => {
    // `gamma` already has an alias recorded. It is not part of the
    // collision, so nothing in the workspace will touch it — but it must
    // survive into what gets submitted.
    const contributions: FacetContribution[] = [
      ...TWO_WAY,
      { ...skill('gamma', 'audit'), overrides: { skills: { audit: { kind: 'aliased', as: 'gamma-audit' } } } },
    ]
    const request = requestFor(contributions)
    const draft = createDraft(request)

    expect(draft.overrides.gamma).toEqual({ skills: { audit: { kind: 'aliased', as: 'gamma-audit' } } })
  })
})

describe('collision draft — resolving', () => {
  test('aliasing one claimant resolves the group and keeps both assets', () => {
    const request = requestFor(TWO_WAY)
    let draft = createDraft(request)
    const alpha = memberOf(evaluateDraft(request, draft), 'alpha', 'review')

    draft = reviseDraft(request, draft, alpha, { kind: 'aliased', as: 'alpha-review' })
    const model = evaluateDraft(request, draft)

    expect(model.confirmable).toBe(true)
    expect(statusOf(model, 'alpha', 'review')).toBe('resolved')
    expect(statusOf(model, 'beta', 'review')).toBe('resolved')
    expect(memberOf(model, 'alpha', 'review').effectiveName).toBe('alpha-review')
    expect(memberOf(model, 'beta', 'review').effectiveName).toBe('review')
  })

  test('omitting every claimant is a legal resolution', () => {
    const request = requestFor(TWO_WAY)
    let draft = createDraft(request)
    for (const member of evaluateDraft(request, draft).groups[0]?.members ?? []) {
      draft = reviseDraft(request, draft, member, { kind: 'omitted' })
    }
    const model = evaluateDraft(request, draft)

    expect(model.confirmable).toBe(true)
    expect(memberOf(model, 'alpha', 'review').effectiveName).toBeNull()
    expect(memberOf(model, 'beta', 'review').effectiveName).toBeNull()
  })

  test('aliasing both claimants apart is accepted', () => {
    const request = requestFor(TWO_WAY)
    let draft = createDraft(request)
    const model0 = evaluateDraft(request, draft)
    draft = reviseDraft(request, draft, memberOf(model0, 'alpha', 'review'), { kind: 'aliased', as: 'a-review' })
    draft = reviseDraft(request, draft, memberOf(model0, 'beta', 'review'), { kind: 'aliased', as: 'b-review' })

    expect(evaluateDraft(request, draft).confirmable).toBe(true)
  })

  test('two claimants aliased to the same name still collide', () => {
    const request = requestFor(TWO_WAY)
    let draft = createDraft(request)
    const model0 = evaluateDraft(request, draft)
    draft = reviseDraft(request, draft, memberOf(model0, 'alpha', 'review'), { kind: 'aliased', as: 'shared' })
    draft = reviseDraft(request, draft, memberOf(model0, 'beta', 'review'), { kind: 'aliased', as: 'shared' })
    const model = evaluateDraft(request, draft)

    expect(model.confirmable).toBe(false)
    expect(statusOf(model, 'alpha', 'review')).toBe('draft-conflict')
    expect(statusOf(model, 'beta', 'review')).toBe('draft-conflict')
  })

  test('Keep removes the override instead of recording an explicit authored arm', () => {
    const request = requestFor(TWO_WAY)
    let draft = createDraft(request)
    const alpha = memberOf(evaluateDraft(request, draft), 'alpha', 'review')

    draft = reviseDraft(request, draft, alpha, { kind: 'aliased', as: 'alpha-review' })
    expect(draft.overrides.alpha).toBeDefined()

    draft = reviseDraft(request, draft, alpha, { kind: 'authored' })
    // The project schema rejects an explicit `authored` override, so the
    // only correct spelling of "use the authored name" is absence.
    expect(draft.overrides.alpha).toBeUndefined()
  })
})

describe('collision draft — conflicts the user creates', () => {
  const THREE = [skill('alpha', 'review'), skill('beta', 'review'), skill('gamma', 'audit')]

  test('aliasing onto an uninvolved asset pulls that asset into the workspace', () => {
    const request = requestFor(THREE)
    let draft = createDraft(request)
    const alpha = memberOf(evaluateDraft(request, draft), 'alpha', 'review')

    // `gamma/audit` was never colliding and is not in the initial report.
    expect(request.groups.flatMap((g) => g.members).some((m) => m.facet === 'gamma')).toBe(false)

    draft = reviseDraft(request, draft, alpha, { kind: 'aliased', as: 'audit' })
    const model = evaluateDraft(request, draft)

    expect(model.confirmable).toBe(false)
    // Reachable, and reachable from the same group — the user can fix
    // either side without hunting for the other one.
    expect(statusOf(model, 'gamma', 'audit')).toBe('draft-conflict')
    expect(statusOf(model, 'alpha', 'review')).toBe('draft-conflict')
    const group = model.groups.find((g) => g.members.some((m) => m.facet === 'gamma'))
    expect(group?.members.map((m) => m.facet).sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('a resolved claimant becomes conflicting when a later edit targets its name', () => {
    const request = requestFor(THREE)
    let draft = createDraft(request)
    const model0 = evaluateDraft(request, draft)

    draft = reviseDraft(request, draft, memberOf(model0, 'alpha', 'review'), { kind: 'aliased', as: 'alpha-review' })
    const model1 = evaluateDraft(request, draft)
    expect(statusOf(model1, 'beta', 'review')).toBe('resolved')

    draft = reviseDraft(request, draft, memberOf(model1, 'alpha', 'review'), { kind: 'aliased', as: 'review' })
    const model2 = evaluateDraft(request, draft)
    expect(statusOf(model2, 'alpha', 'review')).toBe('draft-conflict')
    expect(statusOf(model2, 'beta', 'review')).toBe('draft-conflict')
  })

  test('a claimant dragged in by an alias stays visible after the alias is withdrawn', () => {
    const request = requestFor(THREE)
    let draft = createDraft(request)
    const alpha = memberOf(evaluateDraft(request, draft), 'alpha', 'review')

    draft = reviseDraft(request, draft, alpha, { kind: 'aliased', as: 'audit' })
    draft = reviseDraft(request, draft, alpha, { kind: 'aliased', as: 'alpha-review' })
    const model = evaluateDraft(request, draft)

    // If `gamma` vanished here, the list would reflow under the cursor
    // the moment a user corrected a typo.
    expect(statusOf(model, 'gamma', 'audit')).toBe('resolved')
    expect(model.confirmable).toBe(true)
  })

  test('two assets may exchange effective names', () => {
    const request = requestFor([skill('alpha', 'one', 'two'), skill('beta', 'one')])
    let draft = createDraft(request)

    // Point alpha's `one` at `two`. That drags alpha's own `two` in.
    draft = reviseDraft(request, draft, memberOf(evaluateDraft(request, draft), 'alpha', 'one'), {
      kind: 'aliased',
      as: 'two',
    })
    // Now send `two` the other way. Mid-swap the set is still colliding,
    // which is exactly the state the workspace has to tolerate.
    draft = reviseDraft(request, draft, memberOf(evaluateDraft(request, draft), 'alpha', 'two'), {
      kind: 'aliased',
      as: 'one',
    })
    expect(evaluateDraft(request, draft).confirmable).toBe(false)

    // Free the name beta was holding, and the swap lands.
    draft = reviseDraft(request, draft, memberOf(evaluateDraft(request, draft), 'beta', 'one'), {
      kind: 'aliased',
      as: 'beta-one',
    })

    const model = evaluateDraft(request, draft)
    expect(model.confirmable).toBe(true)
    expect(memberOf(model, 'alpha', 'one').effectiveName).toBe('two')
    expect(memberOf(model, 'alpha', 'two').effectiveName).toBe('one')
  })
})

describe('collision draft — grouping', () => {
  test('separate collisions stay separate groups', () => {
    const request = requestFor([skill('alpha', 'review', 'deploy'), skill('beta', 'review', 'deploy')])
    const model = evaluateDraft(request, createDraft(request))

    expect(model.groups).toHaveLength(2)
    expect(model.groups.map((g) => g.origin)).toEqual(['deploy', 'review'])
  })

  test('merging two collisions with one alias produces one decision surface', () => {
    const request = requestFor([skill('alpha', 'review', 'deploy'), skill('beta', 'review', 'deploy')])
    let draft = createDraft(request)
    const model0 = evaluateDraft(request, draft)

    draft = reviseDraft(request, draft, memberOf(model0, 'alpha', 'review'), { kind: 'aliased', as: 'deploy' })
    const model = evaluateDraft(request, draft)

    // Three assets now want `deploy`. Splitting them across two screens
    // would hide part of the problem from whoever is solving it.
    expect(model.groups).toHaveLength(1)
    expect(model.groups[0]?.members).toHaveLength(4)
  })
})

describe('alias validation', () => {
  test('accepts a legal single-segment name', () => {
    expect(validateAlias('vendor-review')).toBeNull()
  })

  test.each([
    ['Review', 'uppercase'],
    ['review/code', 'a slash'],
    ['-review', 'a leading dash'],
    ['', 'empty'],
  ])('rejects %s (%s) with a reason', (value) => {
    expect(validateAlias(value)).not.toBeNull()
  })

  test('reports the published reason rather than a local paraphrase', () => {
    // The message a user reads while typing must be the message the
    // engine would have produced for the same string. Asserting they are
    // equal is what stops the UI from growing its own friendlier — and
    // eventually divergent — description of the grammar.
    const planned = planMaterialization([
      {
        facet: 'alpha',
        assets: [{ scope: 'project', type: 'skill', name: 'review' }],
        overrides: { skills: { review: { kind: 'aliased', as: 'Review' } } },
      },
    ])
    if (planned.ok || planned.reason !== 'invalid-alias') expect.unreachable()

    expect(validateAlias('Review')).toBe(planned.problems[0]?.reason ?? '')
  })
})
