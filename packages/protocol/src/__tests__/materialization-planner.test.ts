import { describe, expect, test } from 'bun:test'
import type { AssetType, Scope } from '@agent-facets/common'
import {
  type FacetContribution,
  overrideGroupKey,
  type PlanMaterializationResult,
  planMaterialization,
} from '@agent-facets/protocol'

/** A project-scoped authored asset. */
const asset = (type: AssetType, name: string, scope: Scope = 'project') => ({ scope, type, name })

/** A facet contributing assets, optionally with overrides. */
const facet = (
  name: string,
  assets: ReturnType<typeof asset>[],
  overrides?: FacetContribution['overrides'],
): FacetContribution => ({ facet: name, assets, overrides })

/** The effective names materialized by a successful plan, in plan order. */
function effectiveNames(result: PlanMaterializationResult): string[] {
  if (!result.ok) expect.unreachable()
  return result.plan.materialized.map((a) => a.effectiveName)
}

describe('planMaterialization — collision-free sets', () => {
  test('an empty desired set plans nothing', () => {
    const result = planMaterialization([])
    if (!result.ok) expect.unreachable()
    expect(result.plan.assets).toEqual([])
    expect(result.plan.materialized).toEqual([])
    expect(result.staleOverrides).toEqual([])
  })

  test('distinct names across facets need no resolution', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'review')]), facet('b', [asset('skill', 'deploy')])])
    expect(effectiveNames(result)).toEqual(['review', 'deploy'])
  })

  test('an asset with no override materializes under its authored name', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'review')])])
    if (!result.ok) expect.unreachable()
    const planned = result.plan.materialized[0]
    expect(planned?.authoredName).toBe('review')
    expect(planned?.effectiveName).toBe('review')
    expect(planned?.disposition).toEqual({ kind: 'authored' })
  })

  test('an agent and a skill may share a name', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'review')]), facet('b', [asset('agent', 'review')])])
    expect(effectiveNames(result)).toEqual(['review', 'review'])
  })

  test('assets in different scopes never collide', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review', 'project')]),
      facet('b', [asset('skill', 'review', 'user')]),
    ])
    expect(effectiveNames(result)).toEqual(['review', 'review'])
  })

  // The adapter key addresses what is written to disk, so it must be built
  // from the EFFECTIVE name — using the authored name would make ownership
  // bookkeeping point at a file that was never created.
  test('the adapter key of an aliased asset uses its effective name', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { review: { kind: 'aliased', as: 'vendor-review' } } }),
    ])
    if (!result.ok) expect.unreachable()
    const planned = result.plan.materialized[0]
    expect(planned?.adapterKey).toContain('vendor-review')
    expect(planned?.adapterKey).not.toContain('project\u0000skill\u0000review')
  })

  test('assets that cannot coexist still have distinct adapter keys', () => {
    // A skill and a command named `deploy` collide logically but are two
    // different files, so their adapter keys must differ.
    const result = planMaterialization([facet('a', [asset('skill', 'deploy')]), facet('b', [asset('command', 'ship')])])
    if (!result.ok) expect.unreachable()
    const keys = result.plan.materialized.map((a) => a.adapterKey)
    expect(new Set(keys).size).toBe(2)
  })
})

describe('planMaterialization — collisions', () => {
  test('two facets claiming one skill name collide', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'review')]), facet('b', [asset('skill', 'review')])])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.members.map((m) => m.facet)).toEqual(['a', 'b'])
  })

  // Skills and commands share one namespace (design D9).
  test('a skill and a command claiming one name collide', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'deploy')]),
      facet('b', [asset('command', 'deploy')]),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.namespace).toBe('skill-command')
  })

  test('a collision within one facet is still reported', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'deploy'), asset('command', 'deploy')])])
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('collision')
  })

  // The report is exhaustive: users are never marched through repeated
  // attempts discovering one conflict at a time.
  test('every group is reported in one pass', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'one'), asset('skill', 'two'), asset('agent', 'three')]),
      facet('b', [asset('skill', 'one'), asset('command', 'two'), asset('agent', 'three')]),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups).toHaveLength(3)
    expect(result.groups.map((g) => g.effectiveName).sort()).toEqual(['one', 'three', 'two'])
  })

  test('a group with three claimants lists all of them', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')]),
      facet('b', [asset('skill', 'review')]),
      facet('c', [asset('command', 'review')]),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups[0]?.members).toHaveLength(3)
  })

  test('members carry the data needed to identify and revise them', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'review')]), facet('b', [asset('skill', 'review')])])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups[0]?.members[0]).toEqual({
      facet: 'a',
      scope: 'project',
      type: 'skill',
      authoredName: 'review',
      effectiveName: 'review',
      disposition: { kind: 'authored' },
    })
  })

  // Names that differ only by case or normalization resolve to one file on a
  // case-insensitive or normalizing volume, so they must collide rather than
  // silently overwrite each other. Current-format aliases are lowercase ASCII
  // by grammar, so these can only arise from legacy AUTHORED names — which
  // the planner accepts as input precisely so migration stays safe.
  test('authored names differing only by case collide', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'Review')]), facet('b', [asset('skill', 'review')])])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups[0]?.members.map((m) => m.authoredName)).toEqual(['Review', 'review'])
  })

  test('authored names differing only by Unicode normalization collide', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'caf\u00e9')]),
      facet('b', [asset('skill', 'cafe\u0301')]),
    ])
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('collision')
  })

  test('no plan is produced when the set collides', () => {
    const result = planMaterialization([facet('a', [asset('skill', 'review')]), facet('b', [asset('skill', 'review')])])
    expect(result.ok).toBe(false)
    expect('plan' in result).toBe(false)
  })
})

describe('planMaterialization — aliases', () => {
  test('aliasing one claimant resolves the group', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')]),
      facet('b', [asset('skill', 'review')], { skills: { review: { kind: 'aliased', as: 'vendor-review' } } }),
    ])
    expect(effectiveNames(result).sort()).toEqual(['review', 'vendor-review'])
  })

  test('aliasing every claimant resolves the group', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { review: { kind: 'aliased', as: 'a-review' } } }),
      facet('b', [asset('skill', 'review')], { skills: { review: { kind: 'aliased', as: 'b-review' } } }),
    ])
    expect(effectiveNames(result).sort()).toEqual(['a-review', 'b-review'])
  })

  test('an alias keeps the authored name for content and integrity', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { review: { kind: 'aliased', as: 'vendor-review' } } }),
    ])
    if (!result.ok) expect.unreachable()
    const planned = result.plan.materialized[0]
    expect(planned?.authoredName).toBe('review')
    expect(planned?.effectiveName).toBe('vendor-review')
  })

  test('two claimants aliased to the same target still collide', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'one')], { skills: { one: { kind: 'aliased', as: 'shared' } } }),
      facet('b', [asset('skill', 'two')], { skills: { two: { kind: 'aliased', as: 'shared' } } }),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups[0]?.effectiveName).toBe('shared')
    expect(result.groups[0]?.members.map((m) => m.authoredName)).toEqual(['one', 'two'])
  })

  test('an alias colliding with an untouched asset is reported', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'deploy')]),
      facet('b', [asset('skill', 'review')], { skills: { review: { kind: 'aliased', as: 'deploy' } } }),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    // Both sides of the linked conflict are navigable.
    expect(result.groups[0]?.members.map((m) => m.facet)).toEqual(['a', 'b'])
  })

  // Single-pass application is what makes a swap legal. A fixed-point or
  // order-dependent resolver would deadlock or pick a winner here.
  test('two assets may exchange effective names', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'one')], { skills: { one: { kind: 'aliased', as: 'two' } } }),
      facet('b', [asset('skill', 'two')], { skills: { two: { kind: 'aliased', as: 'one' } } }),
    ])
    expect(effectiveNames(result).sort()).toEqual(['one', 'two'])
  })

  test('an alias may target a name freed by an omission', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { review: { kind: 'omitted' } } }),
      facet('b', [asset('skill', 'other')], { skills: { other: { kind: 'aliased', as: 'review' } } }),
    ])
    expect(effectiveNames(result)).toEqual(['review'])
  })

  test('an alias may cross into the sibling type of its namespace', () => {
    const result = planMaterialization([
      facet('a', [asset('command', 'deploy')]),
      facet('b', [asset('skill', 'ship')], { skills: { ship: { kind: 'aliased', as: 'deploy' } } }),
    ])
    expect(result.ok).toBe(false)
  })

  test('an alias may share a name with an agent', () => {
    const result = planMaterialization([
      facet('a', [asset('agent', 'review')]),
      facet('b', [asset('skill', 'ship')], { skills: { ship: { kind: 'aliased', as: 'review' } } }),
    ])
    expect(effectiveNames(result).sort()).toEqual(['review', 'review'])
  })
})

describe('planMaterialization — omissions', () => {
  test('an omitted asset leaves the effective set but stays planned', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { review: { kind: 'omitted' } } }),
    ])
    if (!result.ok) expect.unreachable()
    expect(result.plan.materialized).toEqual([])
    expect(result.plan.assets).toHaveLength(1)
    expect(result.plan.assets[0]?.disposition).toEqual({ kind: 'omitted' })
  })

  test('omitting one claimant resolves the group', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')]),
      facet('b', [asset('skill', 'review')], { skills: { review: { kind: 'omitted' } } }),
    ])
    expect(effectiveNames(result)).toEqual(['review'])
  })

  test('omitting every claimant is a valid resolution', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { review: { kind: 'omitted' } } }),
      facet('b', [asset('skill', 'review')], { skills: { review: { kind: 'omitted' } } }),
    ])
    if (!result.ok) expect.unreachable()
    expect(result.plan.materialized).toEqual([])
    expect(result.plan.assets).toHaveLength(2)
  })

  test('overrides apply per asset type, not across types', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review'), asset('agent', 'review')], { skills: { review: { kind: 'omitted' } } }),
    ])
    if (!result.ok) expect.unreachable()
    expect(result.plan.materialized).toHaveLength(1)
    expect(result.plan.materialized[0]?.type).toBe('agent')
  })
})

describe('planMaterialization — invalid aliases', () => {
  test('an alias outside the grammar fails with the reason', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { review: { kind: 'aliased', as: 'Vendor-Review' } } }),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid-alias') expect.unreachable()
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]?.alias).toBe('Vendor-Review')
    expect(result.problems[0]?.authoredName).toBe('review')
    expect(result.problems[0]?.reason).toBeTruthy()
  })

  test('every invalid alias is reported, not just the first', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'one')], { skills: { one: { kind: 'aliased', as: 'BAD' } } }),
      facet('b', [asset('skill', 'two')], { skills: { two: { kind: 'aliased', as: 'also/bad' } } }),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'invalid-alias') expect.unreachable()
    expect(result.problems).toHaveLength(2)
  })

  // An uninterpretable alias means there is no effective set to check, so
  // an invalid alias takes precedence over any collision report.
  test('an invalid alias preempts collision reporting', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')]),
      facet('b', [asset('skill', 'review')]),
      facet('c', [asset('skill', 'other')], { skills: { other: { kind: 'aliased', as: 'BAD' } } }),
    ])
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('invalid-alias')
  })
})

describe('planMaterialization — stale overrides', () => {
  test('an override naming an absent asset is reported, not fatal', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { 'never-published': { kind: 'omitted' } } }),
    ])
    if (!result.ok) expect.unreachable()
    expect(result.staleOverrides).toEqual([
      { facet: 'a', type: 'skill', authoredName: 'never-published', disposition: { kind: 'omitted' } },
    ])
    // The facet's real asset still materializes.
    expect(result.plan.materialized).toHaveLength(1)
  })

  test('a stale alias does not claim a name', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'other')], { skills: { gone: { kind: 'aliased', as: 'review' } } }),
      facet('b', [asset('skill', 'review')]),
    ])
    if (!result.ok) expect.unreachable()
    expect(result.staleOverrides).toHaveLength(1)
    expect(effectiveNames(result).sort()).toEqual(['other', 'review'])
  })

  // Stale overrides are orthogonal to collisions, so they must survive on
  // the collision arm too — a failed operation still needs to report them.
  test('stale overrides are reported alongside collisions', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { skills: { gone: { kind: 'omitted' } } }),
      facet('b', [asset('skill', 'review')]),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.staleOverrides).toHaveLength(1)
    expect(result.groups).toHaveLength(1)
  })

  test('a stale override on a different type is still matched by type', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'review')], { commands: { review: { kind: 'omitted' } } }),
    ])
    if (!result.ok) expect.unreachable()
    expect(result.staleOverrides).toEqual([
      { facet: 'a', type: 'command', authoredName: 'review', disposition: { kind: 'omitted' } },
    ])
  })
})

describe('planMaterialization — determinism', () => {
  const contributions: FacetContribution[] = [
    facet('zeta', [asset('command', 'b'), asset('skill', 'a')]),
    facet('alpha', [asset('agent', 'c'), asset('skill', 'd')]),
  ]

  test('planned assets are ordered by facet, then asset type, then name', () => {
    const result = planMaterialization(contributions)
    if (!result.ok) expect.unreachable()
    expect(result.plan.assets.map((a) => `${a.facet}/${a.type}/${a.authoredName}`)).toEqual([
      'alpha/skill/d',
      'alpha/agent/c',
      'zeta/skill/a',
      'zeta/command/b',
    ])
  })

  test('the result does not depend on declaration order', () => {
    const forward = planMaterialization(contributions)
    const reversed = planMaterialization([...contributions].reverse())
    expect(forward).toEqual(reversed)
  })

  // Reordering declarations must not change WHICH failure occurs, and must
  // not let either claimant win by being declared first.
  test('reordering declarations does not change a collision report', () => {
    const colliding: FacetContribution[] = [
      facet('a', [asset('skill', 'review')]),
      facet('b', [asset('skill', 'review')]),
      facet('c', [asset('command', 'deploy')]),
      facet('d', [asset('skill', 'deploy')]),
    ]
    const forward = planMaterialization(colliding)
    const reversed = planMaterialization([...colliding].reverse())
    expect(forward).toEqual(reversed)
    if (forward.ok) expect.unreachable()
    if (forward.reason !== 'collision') expect.unreachable()
    expect(forward.groups).toHaveLength(2)
  })

  test('collision groups are deterministically ordered', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'zzz'), asset('skill', 'aaa')]),
      facet('b', [asset('skill', 'zzz'), asset('skill', 'aaa')]),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()
    expect(result.groups.map((g) => g.effectiveName)).toEqual(['aaa', 'zzz'])
  })

  test('the input is not mutated', () => {
    const input: FacetContribution[] = [facet('b', [asset('skill', 'two'), asset('agent', 'one')]), facet('a', [])]
    const snapshot = structuredClone(input)
    planMaterialization(input)
    expect(input).toEqual(snapshot)
  })
})

describe('overrideGroupKey', () => {
  test('maps each asset type to its manifest override group', () => {
    expect(overrideGroupKey('skill')).toBe('skills')
    expect(overrideGroupKey('agent')).toBe('agents')
    expect(overrideGroupKey('command')).toBe('commands')
  })
})

// `constructor` and `__proto__` are legal asset names, and an override map is
// an ordinary object, so an indexed read returns an INHERITED value for
// either. The planner would then treat a function (or `Object.prototype`) as
// a disposition and emit an apparently-successful plan whose disposition
// disappears on serialization.
describe('planMaterialization — inherited property names', () => {
  test('an asset named constructor is not given an inherited disposition', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', 'constructor')], { skills: { other: { kind: 'omitted' } } }),
    ])
    if (!result.ok) expect.unreachable()

    const planned = result.plan.materialized[0]
    expect(planned?.disposition).toEqual({ kind: 'authored' })
    expect(typeof planned?.disposition).toBe('object')
    // The failure mode this guards is silent: a function serializes away.
    expect(JSON.parse(JSON.stringify(result.plan)).materialized[0].disposition).toEqual({ kind: 'authored' })
  })

  test('an asset named __proto__ is not given an inherited disposition', () => {
    const result = planMaterialization([
      facet('a', [asset('skill', '__proto__')], { skills: { other: { kind: 'omitted' } } }),
    ])
    if (!result.ok) expect.unreachable()
    expect(result.plan.materialized[0]?.disposition).toEqual({ kind: 'authored' })
  })

  test('a real override keyed constructor still applies', () => {
    // The fix must not over-reject: an OWN key named `constructor` is a
    // legitimate override and has to keep working.
    const overrides = JSON.parse('{"skills":{"constructor":{"kind":"aliased","as":"ctor"}}}')
    const result = planMaterialization([facet('a', [asset('skill', 'constructor')], overrides)])
    if (!result.ok) expect.unreachable()
    expect(result.plan.materialized[0]?.effectiveName).toBe('ctor')
    expect(result.staleOverrides).toEqual([])
  })

  test('an override keyed constructor naming an absent asset is stale exactly once', () => {
    const overrides = JSON.parse('{"skills":{"constructor":{"kind":"omitted"}}}')
    const result = planMaterialization([facet('a', [asset('skill', 'review')], overrides)])
    if (!result.ok) expect.unreachable()
    expect(result.staleOverrides).toEqual([
      { facet: 'a', type: 'skill', authoredName: 'constructor', disposition: { kind: 'omitted' } },
    ])
  })
})

// The planner documents that its result "shares no mutable structure" with
// its input. Dispositions were the exception: the same object was handed
// straight through, so a later edit to the caller's draft silently rewrote a
// plan that had already derived `effectiveName` and `adapterKey` from the
// old value.
describe('planMaterialization — output snapshots', () => {
  function aliasInput(as: string) {
    const override = { kind: 'aliased' as const, as }
    return { override, contributions: [facet('a', [asset('skill', 'review')], { skills: { review: override } })] }
  }

  test('mutating an input override after planning does not change the plan', () => {
    const { override, contributions } = aliasInput('foo')
    const result = planMaterialization(contributions)
    if (!result.ok) expect.unreachable()

    override.as = 'bar'

    const materialized = result.plan.materialized[0]
    expect(materialized?.disposition).toEqual({ kind: 'aliased', as: 'foo' })
    expect(materialized?.effectiveName).toBe('foo')
    expect(materialized?.adapterKey).toContain('foo')
    expect(result.plan.assets[0]?.disposition).toEqual({ kind: 'aliased', as: 'foo' })
  })

  test('no output collection shares a disposition object with the input or each other', () => {
    const { override, contributions } = aliasInput('foo')
    const result = planMaterialization(contributions)
    if (!result.ok) expect.unreachable()

    const planned = result.plan.assets[0]?.disposition
    const materialized = result.plan.materialized[0]?.disposition
    expect(planned).not.toBe(override)
    expect(materialized).not.toBe(override)
    expect(planned).not.toBe(materialized)
    expect(planned).toEqual(materialized)
  })

  test('stale overrides are snapshotted too', () => {
    const override = { kind: 'aliased' as const, as: 'foo' }
    const result = planMaterialization([facet('a', [asset('skill', 'review')], { skills: { gone: override } })])
    if (!result.ok) expect.unreachable()

    const reported = result.staleOverrides[0]?.disposition
    expect(reported).not.toBe(override)

    override.as = 'bar'
    expect(result.staleOverrides[0]?.disposition).toEqual({ kind: 'aliased', as: 'foo' })
  })

  test('collision members are snapshotted too', () => {
    const override = { kind: 'aliased' as const, as: 'review' }
    const result = planMaterialization([
      facet('a', [asset('skill', 'other')], { skills: { other: override } }),
      facet('b', [asset('skill', 'review')]),
    ])
    if (result.ok) expect.unreachable()
    if (result.reason !== 'collision') expect.unreachable()

    const member = result.groups[0]?.members.find((m) => m.facet === 'a')
    expect(member?.disposition).not.toBe(override)

    override.as = 'moved'
    expect(result.groups[0]?.members.find((m) => m.facet === 'a')?.disposition).toEqual({
      kind: 'aliased',
      as: 'review',
    })
  })
})
