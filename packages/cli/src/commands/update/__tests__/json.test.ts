import { describe, expect, test } from 'bun:test'
import {
  type AuthoredSpecifier,
  type CheckableRegistryFacet,
  hasAdvancingChoice,
  parseVersionSpec,
  type UpdatePlanRow,
} from '@agent-facets/engine'
import type { CliError } from '../../../util/errors.ts'
import { buildUpdateErrorJson, buildUpdateJson, UPDATE_JSON_SCHEMA_VERSION } from '../json.ts'
import { exact } from './fixtures.ts'

function authored(source: string): AuthoredSpecifier {
  const spec = parseVersionSpec(source)
  if (!spec.ok) expect.unreachable(`test fixture declares an invalid specifier: ${source}`)
  return { source, spec: spec.value }
}

function choice(name: string, version: string) {
  return {
    version: exact(version),
    metadata: {
      name,
      version,
      transportHash: `transport-${name}-${version}`,
      contentFingerprint: `content-${name}-${version}`,
    },
  }
}

/**
 * Build a plan row the way discovery does: decide `kind` by asking the
 * engine, never by writing it down here.
 *
 * This is the whole reason these fixtures are local rather than
 * hand-shaped. A test that types `kind: 'current'` beside versions that
 * imply a candidate passes happily against a row the engine can never
 * emit, and proves nothing. Deriving it means an impossible row is not
 * expressible.
 */
function row(args: {
  name: string
  source: string
  current: string
  target: { kind: 'pinned' | 'resolved'; version: string }
  latest: string
}): UpdatePlanRow {
  const facet: CheckableRegistryFacet = {
    name: args.name,
    authored: authored(args.source),
    current: exact(args.current),
    target:
      args.target.kind === 'pinned'
        ? { kind: 'pinned', version: exact(args.target.version) }
        : { kind: 'resolved', ...choice(args.name, args.target.version) },
    latest: choice(args.name, args.latest),
  }
  return hasAdvancingChoice(facet) ? { kind: 'candidate', facet } : { kind: 'current', facet }
}

/** The facet behind a row, for tests that want to question the engine directly. */
function facetOf(planRow: UpdatePlanRow): CheckableRegistryFacet {
  if (planRow.kind === 'unsupported-source') expect.unreachable('row carries no facet')
  return planRow.facet
}

/** Range advances 1.0.0 -> 1.2.0, and the registry agrees. */
const rangeAdvances = row({
  name: 'alpha',
  source: '1.*',
  current: '1.0.0',
  target: { kind: 'resolved', version: '1.2.0' },
  latest: '1.2.0',
})

/** Nothing newer anywhere. */
const trulyCurrent = row({
  name: 'beta',
  source: '1.*',
  current: '1.4.0',
  target: { kind: 'resolved', version: '1.4.0' },
  latest: '1.4.0',
})

/** Pinned at 1.0.0 with 1.4.0 on the registry: range cannot move, latest can. */
const pinnedWithNewerRelease = row({
  name: 'gamma',
  source: '1.0.0',
  current: '1.0.0',
  target: { kind: 'pinned', version: '1.0.0' },
  latest: '1.4.0',
})

/** Pinned at the newest release there is — looks like the one above, is not held. */
const pinnedAtNewest = row({
  name: 'delta',
  source: '1.4.0',
  current: '1.4.0',
  target: { kind: 'pinned', version: '1.4.0' },
  latest: '1.4.0',
})

/** The registry's newest release moved backwards (1.2.0 was unpublished) while the range still advances. */
const registryMovedBackwards = row({
  name: 'epsilon',
  source: '1.*',
  current: '1.0.0',
  target: { kind: 'resolved', version: '1.2.0' },
  latest: '0.9.0',
})

const gitFacet: UpdatePlanRow = {
  kind: 'unsupported-source',
  name: 'zeta',
  source: 'github:acme/zeta',
  sourceKind: 'git',
}

describe('buildUpdateJson', () => {
  test('a candidate whose range advances is updated', () => {
    const doc = buildUpdateJson({ plan: [rangeAdvances], mode: 'range', applied: true })
    expect(doc.facets[0]?.outcome).toBe('updated')
    expect(doc.facets[0]).toMatchObject({
      name: 'alpha',
      declared: '1.*',
      current: '1.0.0',
      target: '1.2.0',
      latest: '1.2.0',
    })
    expect(doc.applied).toBe(true)
    expect(doc.counts).toEqual({ updated: 1, current: 0, held: 0, unsupported: 0 })
  })

  test('a row with nothing newer in either column is current', () => {
    const doc = buildUpdateJson({ plan: [trulyCurrent], mode: 'range', applied: false })
    expect(doc.facets[0]?.outcome).toBe('current')
    expect(doc.counts).toEqual({ updated: 0, current: 1, held: 0, unsupported: 0 })
  })

  test('a pin with a newer release is held in range mode, and is a row discovery can emit', () => {
    expect(hasAdvancingChoice(facetOf(pinnedWithNewerRelease))).toBe(true)
    expect(pinnedWithNewerRelease.kind).toBe('candidate')
    const doc = buildUpdateJson({ plan: [pinnedWithNewerRelease], mode: 'range', applied: false })
    expect(doc.facets[0]?.outcome).toBe('held')
    expect(doc.facets[0]).toMatchObject({ current: '1.0.0', target: '1.0.0', latest: '1.4.0' })
  })

  test('the same pin is updated under latest mode, because that run rewrites it', () => {
    const doc = buildUpdateJson({ plan: [pinnedWithNewerRelease], mode: 'latest', applied: true })
    expect(doc.facets[0]?.outcome).toBe('updated')
  })

  test('a pin already at the newest release is current in both modes', () => {
    expect(buildUpdateJson({ plan: [pinnedAtNewest], mode: 'range', applied: false }).facets[0]?.outcome).toBe(
      'current',
    )
    expect(buildUpdateJson({ plan: [pinnedAtNewest], mode: 'latest', applied: false }).facets[0]?.outcome).toBe(
      'current',
    )
  })

  test('a backwards-moving registry latest is updated in range mode', () => {
    const doc = buildUpdateJson({ plan: [registryMovedBackwards], mode: 'range', applied: true })
    expect(doc.facets[0]?.outcome).toBe('updated')
  })

  test('a backwards-moving registry latest is held, never current, in latest mode', () => {
    const doc = buildUpdateJson({ plan: [registryMovedBackwards], mode: 'latest', applied: false })
    expect(doc.facets[0]?.outcome).toBe('held')
    expect(doc.facets[0]?.outcome).not.toBe('current')
    expect(doc.counts).toEqual({ updated: 0, current: 0, held: 1, unsupported: 0 })
  })

  test('an unsupported-source row reports null versions', () => {
    const doc = buildUpdateJson({ plan: [gitFacet], mode: 'range', applied: false })
    expect(doc.facets[0]?.outcome).toBe('unsupported')
    expect(doc.facets[0]).toEqual({
      name: 'zeta',
      declared: 'github:acme/zeta',
      current: null,
      target: null,
      latest: null,
      resolved: null,
      outcome: 'unsupported',
    })
  })

  describe('resolved', () => {
    /**
     * `resolved` is non-null exactly when `outcome` is `updated` — the
     * property this field exists to guarantee. Assert it over every
     * outcome the document can produce, not just the `updated` cases,
     * and fail loudly if the case list is ever emptied by accident.
     */
    const cases: Array<{ label: string; doc: () => ReturnType<typeof buildUpdateJson> }> = [
      {
        label: 'updated in range mode',
        doc: () => buildUpdateJson({ plan: [rangeAdvances], mode: 'range', applied: true }),
      },
      {
        label: 'updated under --latest',
        doc: () => buildUpdateJson({ plan: [pinnedWithNewerRelease], mode: 'latest', applied: true }),
      },
      { label: 'held', doc: () => buildUpdateJson({ plan: [pinnedWithNewerRelease], mode: 'range', applied: false }) },
      { label: 'current', doc: () => buildUpdateJson({ plan: [trulyCurrent], mode: 'range', applied: false }) },
      { label: 'unsupported', doc: () => buildUpdateJson({ plan: [gitFacet], mode: 'range', applied: false }) },
    ]

    test('the biconditional holds over every outcome, and the case list is not empty', () => {
      expect(cases.length).toBeGreaterThan(0)
      for (const { label, doc } of cases) {
        const facet = doc().facets[0]
        if (!facet) expect.unreachable(`${label}: no facet in document`)
        expect(facet.resolved !== null, `${label}: resolved/outcome disagree (${JSON.stringify(facet)})`).toBe(
          facet.outcome === 'updated',
        )
      }
    })

    test('resolved carries the advancing choice, from the same call facetOutcome uses', () => {
      const rangeDoc = buildUpdateJson({ plan: [rangeAdvances], mode: 'range', applied: true })
      expect(rangeDoc.facets[0]?.resolved).toBe('1.2.0')

      // Pinned target with a newer registry release: latest mode resolves
      // to the registry's latest, not to `target` (which never moves for
      // a pin). Re-deriving from mode instead of `advancingChoice` would
      // still pass this one case, which is why the backwards-registry
      // case below also has to hold.
      const latestDoc = buildUpdateJson({ plan: [pinnedWithNewerRelease], mode: 'latest', applied: true })
      expect(latestDoc.facets[0]?.resolved).toBe('1.4.0')
      expect(latestDoc.facets[0]?.resolved).toBe(latestDoc.facets[0]?.latest)

      // The backwards-registry case: range mode is `updated` even though
      // `latest` moved backwards, so `resolved` must be the range target,
      // not a value keyed off the `latest` column.
      const backwardsDoc = buildUpdateJson({ plan: [registryMovedBackwards], mode: 'range', applied: true })
      expect(backwardsDoc.facets[0]?.resolved).toBe('1.2.0')
      expect(backwardsDoc.facets[0]?.resolved).toBe(backwardsDoc.facets[0]?.target)
    })

    test('the other five fields are unchanged from their present values', () => {
      const doc = buildUpdateJson({ plan: [rangeAdvances], mode: 'range', applied: true })
      expect(doc.facets[0]).toMatchObject({
        name: 'alpha',
        declared: '1.*',
        current: '1.0.0',
        target: '1.2.0',
        latest: '1.2.0',
        outcome: 'updated',
      })
      expect(doc.applied).toBe(true)
      expect(doc.counts).toEqual({ updated: 1, current: 0, held: 0, unsupported: 0 })
    })
  })

  test('an empty plan has no facets and all counts zero', () => {
    const doc = buildUpdateJson({ plan: [], mode: 'range', applied: false })
    expect(doc.facets).toEqual([])
    expect(doc.counts).toEqual({ updated: 0, current: 0, held: 0, unsupported: 0 })
  })

  test('a plan mixing all four outcomes keeps plan order and counts every entry', () => {
    const plan = [rangeAdvances, trulyCurrent, pinnedWithNewerRelease, gitFacet]
    const doc = buildUpdateJson({ plan, mode: 'range', applied: true })
    expect(doc.facets.map((f) => f.name)).toEqual(['alpha', 'beta', 'gamma', 'zeta'])
    expect(doc.facets.map((f) => f.outcome)).toEqual(['updated', 'current', 'held', 'unsupported'])
    expect(doc.counts).toEqual({ updated: 1, current: 1, held: 1, unsupported: 1 })
    const summed = doc.counts.updated + doc.counts.current + doc.counts.held + doc.counts.unsupported
    expect(summed).toBe(doc.facets.length)
  })

  test('the success document is a versioned ok envelope', () => {
    const doc = buildUpdateJson({ plan: [], mode: 'latest', applied: false })
    expect(doc).toMatchObject({ schemaVersion: UPDATE_JSON_SCHEMA_VERSION, ok: true })
    expect(doc.schemaVersion).toBe('1')
  })
})

describe('buildUpdateErrorJson', () => {
  test('round-trips the CliError fields into a not-ok envelope', () => {
    const error: CliError = {
      what: 'could not reach the registry',
      detail: 'connect ETIMEDOUT',
      fix: 'check your network and run `facet update` again',
    }
    const doc = buildUpdateErrorJson(error)
    expect(doc).toEqual({
      schemaVersion: UPDATE_JSON_SCHEMA_VERSION,
      ok: false,
      error: {
        what: 'could not reach the registry',
        detail: 'connect ETIMEDOUT',
        fix: 'check your network and run `facet update` again',
      },
    })
  })

  test('carries an absent detail through as undefined', () => {
    const doc = buildUpdateErrorJson({ what: 'update failed', fix: 'try again' })
    expect(doc).toMatchObject({ ok: false })
    expect(doc.error.detail).toBeUndefined()
  })
})
