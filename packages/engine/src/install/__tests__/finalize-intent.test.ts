import { describe, expect, test } from 'bun:test'
import type { FacetMaterializationOverrides, ProjectAssetOverride } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { finalizeMaterializationIntent } from '../commit/finalize-intent.ts'

/**
 * The last hop before the manifest is written: the resolver's accepted
 * intent is folded into the desired entries, minus anything the planner
 * reported stale.
 *
 * Both maps here are keyed by user-controlled names — facet names on the
 * outside, authored asset names on the inside — so both are read and rebuilt
 * with own-property semantics. A survivor lost to the prototype setter would
 * be silently dropped from `facets.json` while the asset it describes stays
 * on disk under the aliased name nothing records any more.
 */

/** Build a keyed record without letting a `__proto__` literal set a prototype. */
function record<T>(entries: ReadonlyArray<[string, T]>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return out
}

const aliased = (as: string): ProjectAssetOverride => ({ kind: 'aliased', as })

describe('finalizeMaterializationIntent — keys that collide with Object.prototype', () => {
  test('an override on an asset named __proto__ survives as an own key', () => {
    const desiredFacets: Record<string, NormalizedFacetEntry> = { vendor: { source: './v', overrides: undefined } }
    const accepted: Record<string, FacetMaterializationOverrides> = {
      vendor: { skills: record<ProjectAssetOverride>([['__proto__', aliased('safe')]]) },
    }

    finalizeMaterializationIntent(desiredFacets, accepted, [])

    const skills = desiredFacets.vendor?.overrides?.skills
    if (skills === undefined) expect.unreachable()
    expect(Object.hasOwn(skills, '__proto__')).toBe(true)
    expect(Object.keys(skills)).toEqual(['__proto__'])
  })

  test('an override on an asset named constructor is the override, not an inherited function', () => {
    const desiredFacets: Record<string, NormalizedFacetEntry> = { vendor: { source: './v', overrides: undefined } }
    const assetName = 'constructor'
    const accepted: Record<string, FacetMaterializationOverrides> = {
      vendor: { skills: { [assetName]: aliased('safe') } },
    }

    finalizeMaterializationIntent(desiredFacets, accepted, [])

    const skills = desiredFacets.vendor?.overrides?.skills
    if (skills === undefined) expect.unreachable()
    expect(skills[assetName]).toEqual(aliased('safe'))
  })

  test('a facet named constructor reads its own accepted overrides', () => {
    const facetName = 'constructor'
    const desiredFacets: Record<string, NormalizedFacetEntry> = { [facetName]: { source: './v', overrides: undefined } }

    // No accepted entry for it: the complete-map contract says the facet ends
    // up with no overrides.
    finalizeMaterializationIntent(desiredFacets, {}, [])

    expect(desiredFacets[facetName]?.overrides).toBeUndefined()
  })

  // Pruning still has to work on these keys: a stale override is dropped, and
  // dropping the last one collapses the entry back to its compact form.
  test('a stale override on a __proto__ asset is pruned', () => {
    const desiredFacets: Record<string, NormalizedFacetEntry> = { vendor: { source: './v', overrides: undefined } }
    const accepted: Record<string, FacetMaterializationOverrides> = {
      vendor: { skills: record<ProjectAssetOverride>([['__proto__', aliased('safe')]]) },
    }

    const pruned = finalizeMaterializationIntent(desiredFacets, accepted, [
      { facet: 'vendor', type: 'skill', authoredName: '__proto__', disposition: aliased('safe') },
    ])

    expect(pruned).toEqual([{ facet: 'vendor', type: 'skill', authoredName: '__proto__' }])
    expect(desiredFacets.vendor?.overrides).toBeUndefined()
  })
})
