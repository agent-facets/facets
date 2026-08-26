import { describe, expect, test } from 'bun:test'
import type { SupportedLockfile } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../../manifest/mutations.ts'
import { describeVersionSpec } from '../../../registry/describe.ts'
import { MAX_REGISTRY_METADATA_SPECIFIERS } from '../../../registry/resolve-metadata.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from '../../../registry/types.ts'
import { advancingChoice } from '../advancing.ts'
import { discoverUpdates, type ResolveMetadataBatch } from '../discover.ts'
import type { UpdateChoice } from '../manifest-source.ts'
import type { UpdatePlanRow } from '../types.ts'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Prototype-safe record builder: `__proto__` and `constructor` are legal
 * facet names, and a plain object literal would either swallow them or
 * answer an inherited value for a key nobody set.
 */
function record<T>(entries: Array<[string, T]>): Record<string, T> {
  const out = Object.create(null) as Record<string, T>
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return out
}

function manifest(entries: Array<[string, string]>): Record<string, NormalizedFacetEntry> {
  return record(entries.map(([name, source]) => [name, { source, overrides: undefined }]))
}

function lockedRegistry(version: string) {
  return {
    source: { kind: 'registry' as const, registry: 'https://registry.test' },
    version,
    integrity: 'sha256:aaaa',
    assets: [],
  }
}

function lockfile(entries: Array<[string, ReturnType<typeof lockedRegistry>]>): SupportedLockfile {
  return { lockfileVersion: 0.3, facets: record(entries) } as SupportedLockfile
}

const EMPTY_LOCKFILE = lockfile([])

/**
 * A resolver that answers from a `name@spec → version` table, recording
 * every group it was handed so grouping and concurrency are observable.
 */
function resolverFor(
  versions: Record<string, string>,
  options: { groups?: RegistrySpec[][] } = {},
): ResolveMetadataBatch {
  return async (specs) => {
    options.groups?.push([...specs])
    const value: RegistryMetadata[] = []
    for (const spec of specs) {
      const key = `${spec.name}@${renderSpec(spec)}`
      const version = versions[key]
      if (version === undefined) {
        return { ok: false, error: { code: 'NOT_FOUND', name: spec.name, spec: renderSpec(spec) } }
      }
      value.push({
        name: spec.name,
        version,
        transportHash: 'sha256:transport',
        contentFingerprint: 'sha256:content',
      })
    }
    return { ok: true, value }
  }
}

function renderSpec(spec: RegistrySpec): string {
  switch (spec.version.kind) {
    case 'exact':
      return `${spec.version.major}.${spec.version.minor}.${spec.version.patch}`
    case 'majorWildcard':
      return `${spec.version.major}.*`
    case 'minorWildcard':
      return `${spec.version.major}.${spec.version.minor}.*`
    case 'wildcard':
      return '*'
    case 'latest':
      return 'latest'
  }
}

function candidateNames(plan: readonly UpdatePlanRow[]): string[] {
  return plan.flatMap((row) => (row.kind === 'candidate' ? [row.facet.name] : []))
}

/** Which columns of a row would actually move the facet. */
function advancing(row: Extract<UpdatePlanRow, { kind: 'candidate' }>): UpdateChoice[] {
  const choices: UpdateChoice[] = ['range', 'latest']
  return choices.filter((choice) => advancingChoice(row.facet, choice) !== undefined)
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe('discoverUpdates — classifying resolved facets', () => {
  test('reports current, target and latest for a bounded range', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@1.*': '1.8.0', 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    const row = result.plan[0]
    if (row?.kind !== 'candidate') expect.unreachable()
    expect(row.facet.current).toEqual({ kind: 'exact', major: 1, minor: 2, patch: 0 })
    expect(row.facet.target.version).toEqual({ kind: 'exact', major: 1, minor: 8, patch: 0 })
    expect(row.facet.latest.version).toEqual({ kind: 'exact', major: 2, minor: 0, patch: 0 })
    expect(advancing(row)).toEqual(['range', 'latest'])
    expect(row.facet.authored.source).toBe('1.*')
  })

  test('an exact pin is a candidate when only latest advances', async () => {
    // The pin means plain update has nothing to do, but the row still has
    // to appear: `--latest` and the interactive toggle exist precisely to
    // move a pinned facet, and hiding it would make them useless.
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.2.0']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    const row = result.plan[0]
    if (row?.kind !== 'candidate') expect.unreachable()
    expect(advancing(row)).toEqual(['latest'])
    expect(row.facet.target).toEqual({ kind: 'pinned', version: { kind: 'exact', major: 1, minor: 2, patch: 0 } })
  })

  // The bug this guards: resolving `cowsay@1.2.0` to learn a pinned
  // facet's Target asks the registry whether the INSTALLED release still
  // exists. `satisfies` admits only that one version, so the answer can
  // never be anything else — the request's only possible effect is to
  // turn a yanked release into a failure.
  test('an exact pin costs no registry lookup of its own', async () => {
    const groups: RegistrySpec[][] = []
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.2.0']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@latest': '2.0.0' }, { groups }),
    })

    if (!result.ok) expect.unreachable()
    expect(groups[0]?.map(renderSpec)).toEqual(['latest'])
  })

  test('a pinned facet whose installed release was yanked still plans', async () => {
    // Only `latest` is answerable; `cowsay@1.2.0` would 404. Discovery
    // must not care, because the lockfile already says what is installed.
    const result = await discoverUpdates({
      facets: manifest([
        ['cowsay', '1.2.0'],
        ['fortune', '1.*'],
      ]),
      lockfile: lockfile([
        ['cowsay', lockedRegistry('1.2.0')],
        ['fortune', lockedRegistry('1.0.0')],
      ]),
      resolve: resolverFor({ 'cowsay@latest': '2.0.0', 'fortune@1.*': '1.8.0', 'fortune@latest': '1.8.0' }),
    })

    if (!result.ok) expect.unreachable()
    // And the yanked pin does not take the rest of the project with it.
    expect(candidateNames(result.plan)).toEqual(['cowsay', 'fortune'])
  })

  test('a pinned target is never selectable, however the registry answers', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.2.0']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    const row = result.plan[0]
    if (row?.kind !== 'candidate') expect.unreachable()
    expect(advancingChoice(row.facet, 'range')).toBeUndefined()
  })

  test('a facet already at latest is current, not a candidate', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '2.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('2.0.0')]]),
      resolve: resolverFor({ 'cowsay@2.*': '2.0.0', 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    expect(result.plan[0]?.kind).toBe('current')
  })

  test('an older registry answer never becomes a downgrade candidate', async () => {
    // Unpublished releases and caller-relative visibility can both make
    // the registry answer with something older than what is installed.
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('2.0.0')]]),
      resolve: resolverFor({ 'cowsay@*': '1.5.0', 'cowsay@latest': '1.5.0' }),
    })

    if (!result.ok) expect.unreachable()
    expect(result.plan[0]?.kind).toBe('current')
  })

  test.each([
    ['1.2.0', '1.2.0', '1.2.0'],
    ['1.*', '1.0.0', '1.8.0'],
    ['1.2.*', '1.2.0', '1.2.7'],
    ['*', '1.0.0', '3.0.0'],
    ['latest', '1.0.0', '3.0.0'],
  ])('resolves the authored form %p to its target', async (source, locked, target) => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', source]]),
      lockfile: lockfile([['cowsay', lockedRegistry(locked)]]),
      resolve: resolverFor({ [`cowsay@${source}`]: target, 'cowsay@latest': '3.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    const row = result.plan[0]
    if (row?.kind !== 'candidate') expect.unreachable()
    expect(describeVersionSpec(row.facet.target.version)).toBe(target)
    // Latest is asked for separately every time, so it is asserted every
    // time. For `*` and `latest` the two questions have one answer, and
    // that coincidence is the scenario rather than an accident.
    expect(describeVersionSpec(row.facet.latest.version)).toBe('3.0.0')
  })

  test('carries the resolved metadata so application needs no second lookup', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@1.*': '1.8.0', 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    const row = result.plan[0]
    if (row?.kind !== 'candidate') expect.unreachable()
    if (row.facet.target.kind !== 'resolved') expect.unreachable()
    expect(row.facet.target.metadata).toEqual({
      name: 'cowsay',
      version: '1.8.0',
      transportHash: 'sha256:transport',
      contentFingerprint: 'sha256:content',
    })
  })
})

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

describe('discoverUpdates — unsupported sources', () => {
  test('git and local facets are named, not silently treated as current', async () => {
    const result = await discoverUpdates({
      facets: manifest([
        ['from-git', 'https://example.com/cowsay.git'],
        ['from-disk', 'file:../local-facet'],
      ]),
      lockfile: EMPTY_LOCKFILE,
      resolve: resolverFor({}),
    })

    if (!result.ok) expect.unreachable()
    expect(result.plan).toEqual([
      { kind: 'unsupported-source', name: 'from-git', source: 'https://example.com/cowsay.git', sourceKind: 'git' },
      { kind: 'unsupported-source', name: 'from-disk', source: 'file:../local-facet', sourceKind: 'local' },
    ])
  })

  test('unsupported sources do not block registry facets, and plan order is manifest order', async () => {
    const result = await discoverUpdates({
      facets: manifest([
        ['from-git', 'https://example.com/cowsay.git'],
        ['cowsay', '1.*'],
        ['from-disk', 'file:../local-facet'],
        ['zebra', '1.*'],
      ]),
      lockfile: lockfile([
        ['cowsay', lockedRegistry('1.2.0')],
        ['zebra', lockedRegistry('1.0.0')],
      ]),
      resolve: resolverFor({
        'cowsay@1.*': '1.8.0',
        'cowsay@latest': '2.0.0',
        'zebra@1.*': '1.0.0',
        'zebra@latest': '1.0.0',
      }),
    })

    if (!result.ok) expect.unreachable()
    expect(result.plan.map((row) => (row.kind === 'unsupported-source' ? row.name : row.facet.name))).toEqual([
      'from-git',
      'cowsay',
      'from-disk',
      'zebra',
    ])
  })
})

// ---------------------------------------------------------------------------
// Unusable local state
// ---------------------------------------------------------------------------

describe('discoverUpdates — unusable local state', () => {
  test('a registry facet with no lock entry fails discovery', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: EMPTY_LOCKFILE,
      resolve: resolverFor({}),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unusable-facet-state') expect.unreachable()
    expect(result.failure.facets).toEqual([{ name: 'cowsay', reason: { code: 'missing-lock-entry' } }])
  })

  test('a lock entry of another source kind is a mismatch, not a fresh install', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([
        [
          'cowsay',
          {
            source: { kind: 'git', url: 'https://example.com/c.git', commit: 'a'.repeat(40) },
            version: '1.2.0',
            integrity: 'sha256:aaaa',
            assets: [],
          } as unknown as ReturnType<typeof lockedRegistry>,
        ],
      ]),
      resolve: resolverFor({}),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unusable-facet-state') expect.unreachable()
    expect(result.failure.facets[0]?.reason).toEqual({ code: 'lock-source-mismatch', locked: 'git' })
  })

  test('a hand-edited locked version is reported rather than thrown', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('not-a-version')]]),
      resolve: resolverFor({}),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unusable-facet-state') expect.unreachable()
    expect(result.failure.facets[0]?.reason).toEqual({ code: 'invalid-locked-version', version: 'not-a-version' })
  })

  test('a locked version outside the authored range is drift, not an update', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '2.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({}),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unusable-facet-state') expect.unreachable()
    expect(result.failure.facets[0]?.reason).toEqual({
      code: 'locked-version-unsatisfying',
      version: '1.2.0',
      source: '2.*',
    })
  })

  test('an unparseable manifest source is reported with the parser problem', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '^1.2.3']]),
      lockfile: EMPTY_LOCKFILE,
      resolve: resolverFor({}),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unusable-facet-state') expect.unreachable()
    const reason = result.failure.facets[0]?.reason
    if (reason?.code !== 'unparseable-source') expect.unreachable()
    expect(reason.source).toBe('^1.2.3')
    expect(reason.problem.length).toBeGreaterThan(0)
  })

  test('every affected facet is reported in one failure, in project order', async () => {
    const result = await discoverUpdates({
      facets: manifest([
        ['alpha', '1.*'],
        ['beta', '1.*'],
        ['gamma', '1.*'],
      ]),
      lockfile: lockfile([['beta', lockedRegistry('bad')]]),
      resolve: resolverFor({}),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'unusable-facet-state') expect.unreachable()
    expect(result.failure.facets.map((facet) => facet.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('no registry request is made when local state is unusable', async () => {
    let calls = 0
    const counting: ResolveMetadataBatch = async (specs) => {
      calls += 1
      return resolverFor({})(specs)
    }
    await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: EMPTY_LOCKFILE,
      resolve: counting,
    })
    expect(calls).toBe(0)
  })

  test('the locked version need not still be resolvable from the registry', async () => {
    // Repairing a yanked installed version belongs to `facet install`.
    // Update only needs to know what is installed, which the lockfile
    // already says.
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.4.0')]]),
      resolve: resolverFor({ 'cowsay@1.*': '1.8.0', 'cowsay@latest': '2.0.0' }),
    })

    if (!result.ok) expect.unreachable()
    const row = result.plan[0]
    if (row?.kind !== 'candidate') expect.unreachable()
    expect(row.facet.current).toEqual({ kind: 'exact', major: 1, minor: 4, patch: 0 })
  })
})

// ---------------------------------------------------------------------------
// Grouping and failure ordering
// ---------------------------------------------------------------------------

describe('discoverUpdates — batching', () => {
  test('asks for two adjacent specifiers per facet', async () => {
    const groups: RegistrySpec[][] = []
    await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@1.*': '1.8.0', 'cowsay@latest': '2.0.0' }, { groups }),
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.map(renderSpec)).toEqual(['1.*', 'latest'])
  })

  test('splits into groups no larger than the resolver limit', async () => {
    const count = 60 // 120 specifiers → two groups
    const names = Array.from({ length: count }, (_, index) => `facet-${String(index).padStart(3, '0')}`)
    const versions: Record<string, string> = {}
    for (const name of names) {
      versions[`${name}@1.*`] = '1.8.0'
      versions[`${name}@latest`] = '2.0.0'
    }

    const groups: RegistrySpec[][] = []
    const result = await discoverUpdates({
      facets: manifest(names.map((name) => [name, '1.*'])),
      lockfile: lockfile(names.map((name) => [name, lockedRegistry('1.2.0')])),
      resolve: resolverFor(versions, { groups }),
    })

    if (!result.ok) expect.unreachable()
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(MAX_REGISTRY_METADATA_SPECIFIERS)
    expect(groups[1]).toHaveLength(20)
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(MAX_REGISTRY_METADATA_SPECIFIERS)
    }
    expect(candidateNames(result.plan)).toEqual(names)
  })

  test('pairs results back to facets across a group boundary', async () => {
    // 50 facets fill exactly one group, so facet 50 is the first entry of
    // the second group — the place an off-by-one in pairing would show up.
    const count = 51
    const names = Array.from({ length: count }, (_, index) => `facet-${String(index).padStart(3, '0')}`)
    const versions: Record<string, string> = {}
    names.forEach((name, index) => {
      versions[`${name}@1.*`] = `1.${index}.0`
      versions[`${name}@latest`] = `2.${index}.0`
    })

    const result = await discoverUpdates({
      facets: manifest(names.map((name) => [name, '1.*'])),
      lockfile: lockfile(names.map((name) => [name, lockedRegistry('1.0.0')])),
      resolve: resolverFor(versions),
    })

    if (!result.ok) expect.unreachable()
    const last = result.plan[count - 1]
    if (last?.kind !== 'candidate') expect.unreachable()
    if (last.facet.target.kind !== 'resolved') expect.unreachable()
    expect(last.facet.name).toBe('facet-050')
    expect(last.facet.target.metadata.version).toBe('1.50.0')
    expect(last.facet.latest.metadata.version).toBe('2.50.0')
  })

  test('groups are issued concurrently', async () => {
    const names = Array.from({ length: 60 }, (_, index) => `facet-${String(index).padStart(3, '0')}`)
    const versions: Record<string, string> = {}
    for (const name of names) {
      versions[`${name}@1.*`] = '1.8.0'
      versions[`${name}@latest`] = '2.0.0'
    }

    let inFlight = 0
    let peak = 0
    const answer = resolverFor(versions)
    const concurrent: ResolveMetadataBatch = async (specs) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      const result = await answer(specs)
      inFlight -= 1
      return result
    }

    await discoverUpdates({
      facets: manifest(names.map((name) => [name, '1.*'])),
      lockfile: lockfile(names.map((name) => [name, lockedRegistry('1.2.0')])),
      resolve: concurrent,
    })

    expect(peak).toBe(2)
  })

  test('one lookup failure rejects the whole discovery', async () => {
    const result = await discoverUpdates({
      facets: manifest([
        ['good', '1.*'],
        ['bad', '1.*'],
      ]),
      lockfile: lockfile([
        ['good', lockedRegistry('1.0.0')],
        ['bad', lockedRegistry('1.0.0')],
      ]),
      resolve: resolverFor({ 'good@1.*': '1.8.0', 'good@latest': '2.0.0' }),
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('discovery-failed')
  })

  test('the reported failure follows project order, not completion order', async () => {
    const names = Array.from({ length: 60 }, (_, index) => `facet-${String(index).padStart(3, '0')}`)
    const versions: Record<string, string> = {}
    for (const name of names) {
      versions[`${name}@1.*`] = '1.8.0'
      versions[`${name}@latest`] = '2.0.0'
    }
    // Fail one facet in each group; the earlier one must win even though
    // the later group is made to settle first.
    delete versions['facet-005@1.*']
    delete versions['facet-055@1.*']

    const answer = resolverFor(versions)
    const staggered: ResolveMetadataBatch = async (specs) => {
      const isFirstGroup = specs[0]?.name === 'facet-000'
      await new Promise((resolve) => setTimeout(resolve, isFirstGroup ? 20 : 1))
      return answer(specs)
    }

    const result = await discoverUpdates({
      facets: manifest(names.map((name) => [name, '1.*'])),
      lockfile: lockfile(names.map((name) => [name, lockedRegistry('1.2.0')])),
      resolve: staggered,
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'discovery-failed') expect.unreachable()
    if (result.failure.error.code !== 'NOT_FOUND') expect.unreachable()
    expect(result.failure.error.name).toBe('facet-005')
  })
})

// ---------------------------------------------------------------------------
// Incoherent registry answers
// ---------------------------------------------------------------------------

describe('discoverUpdates — incoherent registry answers', () => {
  test('a target outside the authored range fails discovery', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@1.*': '2.0.0', 'cowsay@latest': '2.0.0' }),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'target-outside-range') expect.unreachable()
    expect(result.failure.facet).toBe('cowsay')
    expect(result.failure.source).toBe('1.*')
    expect(result.failure.version).toBe('2.0.0')
  })

  test('a non-exact resolved version fails discovery', async () => {
    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: resolverFor({ 'cowsay@1.*': '1.8.0', 'cowsay@latest': 'latest' }),
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'invalid-resolved-version') expect.unreachable()
    expect(result.failure.lookup).toBe('latest')
    expect(result.failure.version).toBe('latest')
  })

  test('a short result array is reported as a boundary failure', async () => {
    const truncating: ResolveMetadataBatch = async (): Promise<RegistryResult<ReadonlyArray<RegistryMetadata>>> => ({
      ok: true,
      value: [{ name: 'cowsay', version: '1.8.0', transportHash: 'x', contentFingerprint: 'y' }],
    })

    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: truncating,
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'discovery-failed') expect.unreachable()
    expect(result.failure.error.code).toBe('UNEXPECTED_ERROR')
  })

  // The resolver's contract is result-valued, but it reaches the network
  // and is an injection point. A rejection escaping here would leave the
  // command boundary as a bare exit 2 with no remedy attached.
  test('a rejected lookup becomes a structured failure, not a thrown error', async () => {
    const throwing: ResolveMetadataBatch = async () => {
      throw Object.assign(new Error('Unable to connect'), { code: 'ECONNREFUSED' })
    }

    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: throwing,
    })

    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'discovery-failed') expect.unreachable()
    expect(result.failure.error.code).toBe('NETWORK_ERROR')
  })

  test('a rejection that is not an Error is still reported as a value', async () => {
    const throwing: ResolveMetadataBatch = async () => {
      throw 'registry exploded'
    }

    const result = await discoverUpdates({
      facets: manifest([['cowsay', '1.*']]),
      lockfile: lockfile([['cowsay', lockedRegistry('1.2.0')]]),
      resolve: throwing,
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('discovery-failed')
  })
})

// ---------------------------------------------------------------------------
// Empty projects
// ---------------------------------------------------------------------------

describe('discoverUpdates — nothing to do', () => {
  test('an empty manifest produces an empty plan without asking the registry', async () => {
    let calls = 0
    const counting: ResolveMetadataBatch = async () => {
      calls += 1
      return { ok: true, value: [] }
    }
    const result = await discoverUpdates({ facets: manifest([]), lockfile: EMPTY_LOCKFILE, resolve: counting })

    if (!result.ok) expect.unreachable()
    expect(result.plan).toEqual([])
    expect(calls).toBe(0)
  })

  test('a project of only git and local facets never reaches the registry', async () => {
    let calls = 0
    const counting: ResolveMetadataBatch = async () => {
      calls += 1
      return { ok: true, value: [] }
    }
    const result = await discoverUpdates({
      facets: manifest([['from-git', 'https://example.com/c.git']]),
      lockfile: EMPTY_LOCKFILE,
      resolve: counting,
    })

    if (!result.ok) expect.unreachable()
    expect(result.plan).toHaveLength(1)
    expect(calls).toBe(0)
  })
})
