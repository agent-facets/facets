import { describe, expect, test } from 'bun:test'
import type { FacetsJson, Lockfile, LockfileFacet, LockfileSource } from '@agent-facets/protocol'
import { LOCKFILE_VERSION } from '@agent-facets/protocol'
import { detectLockfileDrift } from '../detect-lockfile-drift.ts'

const manifest = (facets: Record<string, string>): FacetsJson => ({ facets })

/** Convert an OLD flat `source` string into the NEW tagged lockfile source. */
const taggedSource = (source: string): LockfileSource => {
  if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || source.startsWith('file:')) {
    return { kind: 'local', path: source }
  }
  if (source.startsWith('github:') || source.includes('git@') || source.endsWith('.git') || source.includes('://')) {
    return { kind: 'git', url: source, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
  }
  return { kind: 'registry', registry: 'https://api.agentfacets.io' }
}

const lockEntry = (version: string, source = version): LockfileFacet => ({
  source: taggedSource(source),
  version,
  integrity: 'sha256:stub',
  assets: [{ scope: 'user', type: 'skill', name: 'planning' }],
})

const lock = (facets: Record<string, LockfileFacet>): Lockfile => ({
  lockfileVersion: LOCKFILE_VERSION,
  facets,
})

describe('detectLockfileDrift', () => {
  test('no drift when every registry entry satisfies its specifier', () => {
    const drift = detectLockfileDrift(manifest({ cowsay: '1.*' }), lock({ cowsay: lockEntry('1.2.3', '1.2.3') }), true)
    expect(drift).toEqual([])
  })

  test('missing lockfile → every manifest facet reported as missing-lockfile', () => {
    const drift = detectLockfileDrift(manifest({ cowsay: '1.2.3', other: '2.0.0' }), lock({}), false)
    expect(drift).toEqual([
      { name: 'cowsay', reason: 'missing-lockfile', manifestSpec: '1.2.3' },
      { name: 'other', reason: 'missing-lockfile', manifestSpec: '2.0.0' },
    ])
  })

  test('manifest facet absent from lockfile → no-entry', () => {
    const drift = detectLockfileDrift(
      manifest({ cowsay: '1.2.3', extra: '0.2.0' }),
      lock({ cowsay: lockEntry('1.2.3') }),
      true,
    )
    expect(drift).toEqual([{ name: 'extra', reason: 'no-entry', manifestSpec: '0.2.0' }])
  })

  test('locked version does not satisfy exact specifier → unsatisfied with lockedVersion', () => {
    const drift = detectLockfileDrift(manifest({ cowsay: '0.1.2' }), lock({ cowsay: lockEntry('0.1.1') }), true)
    expect(drift).toEqual([{ name: 'cowsay', reason: 'unsatisfied', manifestSpec: '0.1.2', lockedVersion: '0.1.1' }])
  })

  test('locked version outside a widened wildcard → unsatisfied', () => {
    const drift = detectLockfileDrift(manifest({ cowsay: '2.*' }), lock({ cowsay: lockEntry('1.2.3') }), true)
    expect(drift).toEqual([{ name: 'cowsay', reason: 'unsatisfied', manifestSpec: '2.*', lockedVersion: '1.2.3' }])
  })

  test('non-registry (local/git) entries are not version-checked, only required to exist', () => {
    // A local source whose entry exists is fine regardless of version.
    const drift = detectLockfileDrift(manifest({ local: './pkg' }), lock({ local: lockEntry('9.9.9', './pkg') }), true)
    expect(drift).toEqual([])
  })

  test('git entry whose manifest URL changed → source-changed', () => {
    const drift = detectLockfileDrift(
      manifest({ planner: 'github:attacker/planner' }),
      lock({ planner: lockEntry('2.0.0', 'github:agent-facets/planner') }),
      true,
    )
    expect(drift).toEqual([
      {
        name: 'planner',
        reason: 'source-changed',
        manifestSpec: 'github:attacker/planner',
        lockedSource: 'github:agent-facets/planner',
      },
    ])
  })

  test('local entry whose manifest path changed → source-changed', () => {
    const drift = detectLockfileDrift(
      manifest({ cowsay: './facets/cowsay-EVIL' }),
      lock({ cowsay: lockEntry('1.0.0', './facets/cowsay-v1') }),
      true,
    )
    expect(drift).toEqual([
      {
        name: 'cowsay',
        reason: 'source-changed',
        manifestSpec: './facets/cowsay-EVIL',
        lockedSource: './facets/cowsay-v1',
      },
    ])
  })

  test('git entry whose manifest source is unchanged → no drift', () => {
    const drift = detectLockfileDrift(
      manifest({ planner: 'github:agent-facets/planner' }),
      lock({ planner: lockEntry('2.0.0', 'github:agent-facets/planner') }),
      true,
    )
    expect(drift).toEqual([])
  })

  test('git entry whose manifest shorthand canonicalizes to the locked URL → no drift', () => {
    // Manifest keeps `github:` shorthand; the lock stores the canonical
    // `https://...git` URL a fresh install wrote. The frozen pre-flight must
    // NOT report drift just because the raw strings differ.
    const drift = detectLockfileDrift(
      manifest({ planner: 'github:agent-facets/planner' }),
      lock({ planner: lockEntry('2.0.0', 'https://github.com/agent-facets/planner.git') }),
      true,
    )
    expect(drift).toEqual([])
  })

  test('git entry whose manifest adds only a #ref → no drift', () => {
    // A ref is a manifest concern, not lockfile provenance: the repository
    // URL is unchanged, so this is reproducible, not source drift.
    const drift = detectLockfileDrift(
      manifest({ planner: 'github:agent-facets/planner#main' }),
      lock({ planner: lockEntry('2.0.0', 'https://github.com/agent-facets/planner.git') }),
      true,
    )
    expect(drift).toEqual([])
  })

  test('local entry whose manifest path canonicalizes (file: prefix) to the locked path → no drift', () => {
    // `parseFacetSource` strips the `file:` prefix; the canonical path then
    // matches the locked path, so there is no drift.
    const drift = detectLockfileDrift(
      manifest({ cowsay: 'file:./facets/cowsay-v1' }),
      lock({ cowsay: lockEntry('1.0.0', './facets/cowsay-v1') }),
      true,
    )
    expect(drift).toEqual([])
  })

  test('registry spec text change that still satisfies is NOT source-changed', () => {
    // Manifest widened 1.2.3 → 1.* while the lock stays at 1.2.3 (which
    // satisfies). This is reproducible, not drift — registry source/version
    // drift is governed by `satisfies`, never reported as `source-changed`.
    const drift = detectLockfileDrift(manifest({ cowsay: '1.*' }), lock({ cowsay: lockEntry('1.2.3', '1.2.3') }), true)
    expect(drift).toEqual([])
  })

  test('lockfile entry absent from the manifest → orphaned', () => {
    const drift = detectLockfileDrift(
      manifest({ cowsay: '1.2.3' }),
      lock({ cowsay: lockEntry('1.2.3'), stale: lockEntry('4.5.6') }),
      true,
    )
    expect(drift).toEqual([{ name: 'stale', reason: 'orphaned', lockedVersion: '4.5.6' }])
  })

  test('manifest-side drift is reported before orphans', () => {
    const drift = detectLockfileDrift(
      manifest({ cowsay: '0.1.2' }),
      lock({ cowsay: lockEntry('0.1.1'), stale: lockEntry('4.5.6') }),
      true,
    )
    expect(drift).toEqual([
      { name: 'cowsay', reason: 'unsatisfied', manifestSpec: '0.1.2', lockedVersion: '0.1.1' },
      { name: 'stale', reason: 'orphaned', lockedVersion: '4.5.6' },
    ])
  })

  test('orphans are not reported when the lockfile did not previously exist', () => {
    // lockfileExisted=false means a fresh bootstrap: every manifest facet is
    // missing-lockfile and there is no prior lockfile to orphan from.
    const drift = detectLockfileDrift(manifest({ cowsay: '1.2.3' }), lock({}), false)
    expect(drift).toEqual([{ name: 'cowsay', reason: 'missing-lockfile', manifestSpec: '1.2.3' }])
  })
})
