import { describe, expect, test } from 'bun:test'
import type { FacetsJson, Lockfile, LockfileFacet } from '@agent-facets/protocol'
import { LOCKFILE_VERSION } from '@agent-facets/protocol'
import { detectLockfileDrift } from '../detect-lockfile-drift.ts'

const manifest = (facets: Record<string, string>): FacetsJson => ({ facets })

const lockEntry = (version: string, source = version): LockfileFacet => ({
  source,
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
    const drift = detectLockfileDrift(
      manifest({ cowsay: '1.2.3', other: '1.*' }),
      lock({ cowsay: lockEntry('1.2.3'), other: lockEntry('1.5.0') }),
      true,
    )
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
