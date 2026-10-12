import { describe, expect, test } from 'bun:test'
import type { Lockfile02, Lockfile02Facet, LockfileSource, SupportedLockfile } from '@agent-facets/protocol'
import { LOCKFILE_VERSION_0_2 } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { detectLockfileDrift } from '../detect-lockfile-drift.ts'

/** Build the normalized facet map from a plain name → specifier record. */
const manifest = (facets: Record<string, string>): Record<string, NormalizedFacetEntry> =>
  Object.fromEntries(Object.entries(facets).map(([name, source]) => [name, { source, overrides: undefined }]))

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

const lockEntry = (version: string, source = version): Lockfile02Facet => ({
  source: taggedSource(source),
  version,
  integrity: 'sha256:stub',
  assets: [
    {
      scope: 'user',
      type: 'skill',
      name: 'planning',
      files: [{ path: 'skills/planning/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
    },
  ],
})

const lock = (facets: Record<string, Lockfile02Facet>): Lockfile02 => ({
  lockfileVersion: LOCKFILE_VERSION_0_2,
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

  // A changed KIND of source is the swap the per-kind comparisons above never
  // saw: a registry entry has no URL or path to compare, so a manifest that
  // moved a registry facet to a git fork passed coverage untouched. Every
  // readable lockfile version is checked, because the rule is about the
  // source, not about what else the format records.
  describe('a different kind of source than the locked one → source-changed', () => {
    const SOURCES = {
      registry: {
        manifest: '2.0.0',
        locked: { kind: 'registry', registry: 'https://api.agentfacets.io' },
        described: 'https://api.agentfacets.io',
      },
      git: {
        manifest: 'github:agent-facets/planner',
        locked: { kind: 'git', url: 'https://github.com/agent-facets/planner.git', commit: 'a'.repeat(40) },
        described: 'https://github.com/agent-facets/planner.git',
      },
      local: {
        manifest: './vendor/planner',
        locked: { kind: 'local', path: './vendor/planner' },
        described: './vendor/planner',
      },
    } as const satisfies Record<string, { manifest: string; locked: LockfileSource; described: string }>

    type Kind = keyof typeof SOURCES

    /** One locked `planner` entry from `kind`, shaped for the given lockfile version. */
    function lockedAt(version: 0.2 | 0.3 | 0.4, kind: Kind): SupportedLockfile {
      const asset = {
        scope: 'user',
        type: 'skill',
        name: 'planning',
        ...(version === 0.2 ? {} : { materialization: { kind: 'authored' } }),
        files: [{ path: 'skills/planning/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
      }
      return {
        lockfileVersion: version,
        facets: {
          planner: {
            source: SOURCES[kind].locked,
            version: '2.0.0',
            integrity: 'sha256:stub',
            assets: [asset],
            ...(version === 0.4 ? { servers: [] } : {}),
          },
        },
      } as SupportedLockfile
    }

    const KINDS = Object.keys(SOURCES) as Kind[]
    const TRANSITIONS = KINDS.flatMap((from) => KINDS.filter((to) => to !== from).map((to) => [from, to] as const))
    const CASES = ([0.2, 0.3, 0.4] as const).flatMap((version) =>
      TRANSITIONS.map(([from, to]) => [version, from, to] as const),
    )

    test('every pair of kinds is covered', () => {
      expect(TRANSITIONS).toHaveLength(6)
      expect(CASES).toHaveLength(18)
    })

    test.each(CASES)('lockfile %p: locked from %s, manifest now %s', (version, from, to) => {
      const drift = detectLockfileDrift(manifest({ planner: SOURCES[to].manifest }), lockedAt(version, from), true)
      expect(drift).toEqual([
        {
          name: 'planner',
          reason: 'source-changed',
          manifestSpec: SOURCES[to].manifest,
          lockedSource: SOURCES[from].described,
        },
      ])
    })

    test.each(
      ([0.2, 0.3, 0.4] as const).flatMap((version) => KINDS.map((kind) => [version, kind] as const)),
    )('lockfile %p: an unchanged %s source is not drift', (version, kind) => {
      expect(detectLockfileDrift(manifest({ planner: SOURCES[kind].manifest }), lockedAt(version, kind), true)).toEqual(
        [],
      )
    })

    test('a changed kind is reported once, never also as an unsatisfied version', () => {
      // A registry specifier the locked git version does not satisfy: the
      // source is the cause, and the version mismatch is only a symptom of it.
      const drift = detectLockfileDrift(manifest({ planner: '9.9.9' }), lockedAt(0.4, 'git'), true)
      expect(drift.map((entry) => entry.reason)).toEqual(['source-changed'])
    })
  })

  test('orphans are not reported when the lockfile did not previously exist', () => {
    // lockfileExisted=false means a fresh bootstrap: every manifest facet is
    // missing-lockfile and there is no prior lockfile to orphan from.
    const drift = detectLockfileDrift(manifest({ cowsay: '1.2.3' }), lock({}), false)
    expect(drift).toEqual([{ name: 'cowsay', reason: 'missing-lockfile', manifestSpec: '1.2.3' }])
  })
})
