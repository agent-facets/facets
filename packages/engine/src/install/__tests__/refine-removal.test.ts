import { describe, expect, test } from 'bun:test'
import {
  CURRENT_LOCKFILE_VERSION,
  type CurrentLockfileFacet,
  canonicalPrimaryPath,
  type McpServerFingerprint,
  type SupportedLockfile,
} from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import {
  CURRENT_RECEIPT_VERSION,
  type ProjectReceiptState,
  type Receipt,
  type ReceiptFacetEntry,
  type ReceiptUnavailableReason,
  receiptEntryForLockedFacet,
} from '../receipt.ts'
import { refineRemoval } from '../remove/refine.ts'

/**
 * The removal-only path, exercised directly.
 *
 * Everything here is about keys, because this path is the one place a facet
 * key reaches a lockfile write WITHOUT passing through resolution — and it is
 * resolution that rejects a name like `__proto__`. A remaining facet dropped
 * by the prototype setter would lose its lockfile entry while its assets
 * stayed on disk, claimed by nothing and therefore never deletable.
 */

const HASH = `sha256:${'0'.repeat(64)}`

/**
 * A locked entry whose one skill is named after the facet, so several
 * remaining facets can coexist without colliding — a collision would make the
 * path bail for a reason that has nothing to do with what is under test.
 */
function lockedEntry(name: string, assetName = `skill-${name.replace(/[^a-z]/g, '')}`) {
  return {
    source: { kind: 'local' as const, path: `./vendor/${name}` },
    version: '1.0.0',
    integrity: `sha256:${'a'.repeat(64)}`,
    assets: [
      {
        scope: 'project' as const,
        type: 'skill' as const,
        name: assetName,
        materialization: { kind: 'authored' as const },
        files: [{ path: `skills/${assetName}/SKILL.md`, integrity: HASH }],
      },
    ],
  }
}

/** Build a keyed record without letting a `__proto__` literal set a prototype. */
function record<T>(entries: ReadonlyArray<[string, T]>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return out
}

/** One locked asset, spelled the way a test cares about it. */
interface LockedAssetSpec {
  type?: 'skill' | 'command'
  name: string
  materialization?: { kind: 'authored' } | { kind: 'aliased'; as: string } | { kind: 'omitted' }
}

/** A locked entry with exactly the assets a test names. */
function entryWith(assets: readonly LockedAssetSpec[], version = '1.0.0'): CurrentLockfileFacet {
  return {
    source: { kind: 'local' as const, path: './vendor/x' },
    version,
    integrity: `sha256:${'a'.repeat(64)}`,
    assets: assets.map((spec) => {
      const type = spec.type ?? ('skill' as const)
      return {
        scope: 'project' as const,
        type,
        name: spec.name,
        materialization: spec.materialization ?? ({ kind: 'authored' } as const),
        files: [{ path: canonicalPrimaryPath(type, spec.name), integrity: HASH }],
      }
    }),
  }
}

/** Locked entries, each pointing at the local source its facet name implies. */
function lockfileOf(entries: ReadonlyArray<[string, CurrentLockfileFacet]>): SupportedLockfile {
  return {
    lockfileVersion: CURRENT_LOCKFILE_VERSION,
    facets: record(
      entries.map(([name, entry]) => [
        name,
        { ...entry, source: { kind: 'local' as const, path: `./vendor/${name}` } },
      ]),
    ),
  }
}

/**
 * A receipt that witnesses exactly what the lockfile records — the state a
 * machine that ran the install itself would be in.
 */
function receiptFor(lockfile: SupportedLockfile, opts: { without?: string } = {}): Receipt {
  const facets: Array<[string, ReceiptFacetEntry]> = []
  for (const [name, entry] of Object.entries(lockfile.facets)) {
    if (name === opts.without) continue
    facets.push([name, receiptEntryForLockedFacet(entry, [])])
  }
  return { version: CURRENT_RECEIPT_VERSION, path: '/tmp/project', facets: record(facets) }
}

function loaded(receipt: Receipt): ProjectReceiptState {
  return {
    kind: 'loaded',
    record: { authority: 'assets-and-configuration', path: receipt.path, facets: receipt.facets },
    invalidEntries: [],
  }
}

/** No usable local evidence, whatever the reason. Ownership is zero. */
function unavailable(reason: ReceiptUnavailableReason): ProjectReceiptState {
  return { kind: 'unavailable', reason, projectPath: '/tmp/project' }
}

function desiredOnly(names: readonly string[]): Record<string, NormalizedFacetEntry> {
  return record(names.map((name) => [name, { source: `./vendor/${name}`, overrides: undefined }]))
}

describe('refineRemoval — remaining-facet keys that collide with Object.prototype', () => {
  const desiredFacets: Record<string, NormalizedFacetEntry> = record([
    ['__proto__', { source: './vendor/__proto__', overrides: undefined }],
    ['keep', { source: './vendor/keep', overrides: undefined }],
  ])

  const previousLockfile: SupportedLockfile = {
    lockfileVersion: CURRENT_LOCKFILE_VERSION,
    facets: record([
      ['__proto__', lockedEntry('__proto__')],
      ['keep', lockedEntry('keep')],
      ['gone', lockedEntry('gone')],
    ]),
  }

  test('carries a __proto__ remaining facet into the rebuilt entries', () => {
    const result = refineRemoval({
      desiredFacets,
      previousLockfile,
      lockfileExisted: true,
      receiptState: loaded(receiptFor(previousLockfile)),
    })

    if (result.kind !== 'refined') expect.unreachable()
    expect(Object.hasOwn(result.refinement.facetEntries, '__proto__')).toBe(true)
    expect(Object.keys(result.refinement.facetEntries).sort()).toEqual(['__proto__', 'keep'])
    // The removed facet takes its entry with it, which is the whole point of
    // the operation — so a passing test cannot just be "nothing was dropped".
    expect(Object.hasOwn(result.refinement.facetEntries, 'gone')).toBe(false)
  })

  test('carries a __proto__ remaining facet into the persisted overrides', () => {
    const withOverrides: Record<string, NormalizedFacetEntry> = record([
      [
        '__proto__',
        { source: './vendor/__proto__', overrides: { skills: { review: { kind: 'aliased', as: 'renamed' } } } },
      ],
    ])
    const locked: SupportedLockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: record([
        [
          '__proto__',
          {
            ...lockedEntry('__proto__'),
            assets: [
              {
                scope: 'project' as const,
                type: 'skill' as const,
                name: 'review',
                materialization: { kind: 'aliased' as const, as: 'renamed' },
                files: [{ path: 'skills/review/SKILL.md', integrity: HASH }],
              },
            ],
          },
        ],
      ]),
    }

    const result = refineRemoval({
      desiredFacets: withOverrides,
      previousLockfile: locked,
      lockfileExisted: true,
      receiptState: loaded(receiptFor(locked)),
    })

    if (result.kind !== 'refined') expect.unreachable()
    expect(Object.hasOwn(result.refinement.overrides, '__proto__')).toBe(true)
    expect(Object.hasOwn(result.refinement.receiptFacets, '__proto__')).toBe(true)
  })

  // Ordering is part of the contract shared with the planner and the writer;
  // a set that round-trips through refinement must come back in the same
  // order it would have been written in.
  test('orders remaining facets by code unit', () => {
    const scoped: Record<string, NormalizedFacetEntry> = record(
      ['@zeta/a', 'alpha', '@alpha/b'].map((name) => [name, { source: `./vendor/${name}`, overrides: undefined }]),
    )
    const locked: SupportedLockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: record(['@zeta/a', 'alpha', '@alpha/b'].map((name) => [name, lockedEntry(name)])),
    }

    const result = refineRemoval({
      desiredFacets: scoped,
      previousLockfile: locked,
      lockfileExisted: true,
      receiptState: loaded(receiptFor(locked)),
    })

    if (result.kind !== 'refined') expect.unreachable()
    expect(result.refinement.outcomes.map((o) => o.name)).toEqual(['@alpha/b', '@zeta/a', 'alpha'])
  })
})

/**
 * An identity a remaining facet KEEPS, that something being dropped also
 * claimed.
 *
 * The refined path writes nothing, so it cannot put the remaining facet's
 * content back at a name whose bytes belong to the claimant it is deleting.
 * Planning the remaining facets alone cannot see this: the dropped claimant
 * is, by construction, no longer in the desired set.
 */
describe('refineRemoval — an identity inherited from a dropped entry', () => {
  const desiredFacets = desiredOnly(['keep'])

  function refine(previousLockfile: SupportedLockfile) {
    return refineRemoval({
      desiredFacets,
      previousLockfile,
      lockfileExisted: true,
      receiptState: loaded(receiptFor(previousLockfile)),
    })
  }

  test('a dropped entry claiming a retained identity forces ordinary resolution', () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'shared' }])],
        ['gone', entryWith([{ name: 'shared' }])],
      ]),
    )

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'retained-identity-contested') expect.unreachable()
    expect(result.reason.effectiveName).toBe('shared')
    expect(result.reason.remaining).toBe('keep')
    expect(result.reason.contestedBy).toEqual(['gone'])
  })

  test("a dropped entry's recorded alias contends, not its authored name", () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'shared' }])],
        ['gone', entryWith([{ name: 'other', materialization: { kind: 'aliased', as: 'shared' } }])],
      ]),
    )

    if (result.kind !== 'not-applicable') expect.unreachable()
    expect(result.reason.code).toBe('retained-identity-contested')
  })

  // Skills and commands share one materialization namespace, so a tool that
  // invokes both by name has one slot for them. Matching on the adapter key
  // alone would miss this and delete the command out from under the facet
  // that is staying.
  test('a dropped claim in the same namespace contends across asset types', () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'shared' }])],
        ['gone', entryWith([{ type: 'command', name: 'shared' }])],
      ]),
    )

    if (result.kind !== 'not-applicable') expect.unreachable()
    expect(result.reason.code).toBe('retained-identity-contested')
  })

  test('a dropped claim differing only by case contends', () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'shared' }])],
        ['gone', entryWith([{ name: 'Shared' }])],
      ]),
    )

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'retained-identity-contested') expect.unreachable()
    expect(result.reason.effectiveName).toBe('Shared')
    expect(result.reason.contestedBy).toEqual(['gone'])
  })

  test('a dropped claim differing only by Unicode normalization contends', () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'caf\u00e9' }])],
        ['gone', entryWith([{ name: 'cafe\u0301' }])],
      ]),
    )

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'retained-identity-contested') expect.unreachable()
    expect(result.reason.effectiveName).toBe('cafe\u0301')
    expect(result.reason.contestedBy).toEqual(['gone'])
  })

  test('an omitted asset on a dropped entry never contends', () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'shared' }])],
        ['gone', entryWith([{ name: 'shared', materialization: { kind: 'omitted' } }])],
      ]),
    )

    // Nothing was ever written at that identity for `gone`, so the remaining
    // facet's bytes are the only bytes there.
    expect(result.kind).toBe('refined')
  })

  test('two dropped entries contending only with each other still refine', () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'kept' }])],
        ['goneA', entryWith([{ name: 'shared' }])],
        ['goneB', entryWith([{ name: 'shared' }])],
      ]),
    )

    // The identity is leaving disk entirely; nothing that stays inherits it.
    expect(result.kind).toBe('refined')
  })

  test('an uncontested remaining facet still refines', () => {
    const result = refine(
      lockfileOf([
        ['keep', entryWith([{ name: 'kept' }])],
        ['gone', entryWith([{ name: 'dropped' }])],
      ]),
    )

    expect(result.kind).toBe('refined')
  })
})

/**
 * The lockfile is shared state; the receipt is this machine's. A rewrite that
 * believes the lockfile about files it never wrote replaces an accurate
 * ownership record with a claim, and the real file is then unreachable.
 */
describe('refineRemoval — the receipt must witness every remaining facet', () => {
  const desiredFacets = desiredOnly(['keep'])
  const previousLockfile = lockfileOf([
    ['keep', entryWith([{ name: 'review' }])],
    ['gone', entryWith([{ name: 'dropped' }])],
  ])

  function refine(receipt: Receipt) {
    return refineRemoval({ desiredFacets, previousLockfile, lockfileExisted: true, receiptState: loaded(receipt) })
  }

  /** The agreeing receipt, for a test to disturb in exactly one way. */
  function witnessed(): { receipt: Receipt; keep: ReceiptFacetEntry } {
    const receipt = receiptFor(previousLockfile)
    const keep = receipt.facets.keep
    if (keep === undefined) expect.unreachable()
    return { receipt, keep }
  }

  test('an alias the receipt does not witness does not refine', () => {
    const { receipt, keep } = witnessed()
    const asset = keep.assets[0]
    if (asset === undefined) expect.unreachable()
    // A pulled lockfile can say "aliased" about a file this machine wrote
    // under its authored name. Believing it strands the authored file.
    asset.materialization = { kind: 'aliased', as: 'vendor-review' }

    const result = refine(receipt)

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'remaining-receipt-disagrees') expect.unreachable()
    expect(result.reason.facet).toBe('keep')
    expect(result.reason.disagreement.kind).toBe('disposition')
  })

  test('a version the receipt disagrees with does not refine', () => {
    const { receipt, keep } = witnessed()
    keep.version = '0.9.0'

    const result = refine(receipt)

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'remaining-receipt-disagrees') expect.unreachable()
    if (result.reason.disagreement.kind !== 'version') expect.unreachable()
    expect(result.reason.disagreement.recorded).toBe('0.9.0')
    expect(result.reason.disagreement.locked).toBe('1.0.0')
  })

  test('a locked asset the receipt never recorded does not refine', () => {
    const { receipt, keep } = witnessed()
    keep.assets = []

    const result = refine(receipt)

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'remaining-receipt-disagrees') expect.unreachable()
    if (result.reason.disagreement.kind !== 'asset-unrecorded') expect.unreachable()
    expect(result.reason.disagreement.authoredName).toBe('review')
  })

  test('owned files the receipt disagrees with do not refine', () => {
    const { receipt, keep } = witnessed()
    const asset = keep.assets[0]
    if (asset === undefined) expect.unreachable()
    asset.files = [...asset.files, 'skills/review/refs/api.md']

    const result = refine(receipt)

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'remaining-receipt-disagrees') expect.unreachable()
    expect(result.reason.disagreement.kind).toBe('owned-files')
  })

  // A facet the receipt does not mention is UNTRACKED, not a gap the lockfile
  // may answer for. Refining would commit a receipt claiming files this
  // machine has no evidence it wrote; the ordinary path materializes them
  // instead, and only then are they owned.
  test('a remaining facet the receipt does not mention does not refine', () => {
    const result = refine(receiptFor(previousLockfile, { without: 'keep' }))

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'remaining-untracked') expect.unreachable()
    expect(result.reason.facet).toBe('keep')
  })

  test('an omitted locked asset need not appear in the receipt', () => {
    const lockfile = lockfileOf([
      ['keep', entryWith([{ name: 'review' }, { name: 'scratch', materialization: { kind: 'omitted' } }])],
      ['gone', entryWith([{ name: 'dropped' }])],
    ])
    // The omission is recorded intent on both sides, so it is not drift.
    const omitting = record<NormalizedFacetEntry>([
      ['keep', { source: './vendor/keep', overrides: { skills: { scratch: { kind: 'omitted' } } } }],
    ])

    const result = refineRemoval({
      desiredFacets: omitting,
      previousLockfile: lockfile,
      lockfileExisted: true,
      receiptState: loaded(receiptFor(lockfile)),
    })

    if (result.kind !== 'refined') expect.unreachable()
    expect(result.refinement.receiptFacets.keep?.assets.map((a) => a.name)).toEqual(['review'])
  })

  test('a receipt asset the lockfile no longer lists is dropped from the carried-forward record', () => {
    const { receipt, keep } = witnessed()
    keep.assets = [
      ...keep.assets,
      {
        scope: 'project',
        type: 'skill',
        name: 'legacy',
        materialization: { kind: 'authored' },
        files: ['skills/legacy/SKILL.md'],
      },
    ]

    const result = refine(receipt)

    if (result.kind !== 'refined') expect.unreachable()
    // Dropped from the record this run commits, but still in the ownership
    // index — which is what makes the delete pass able to clean it up.
    expect(result.refinement.receiptFacets.keep?.assets.map((a) => a.name)).toEqual(['review'])
    expect([...result.refinement.previousOwnership.values()].some((o) => o.effectiveName === 'legacy')).toBe(true)
  })
})

/**
 * No receipt evidence at all — missing, corrupt, or describing another
 * project. Every reason means the same thing: zero proven ownership. A path
 * that writes nothing cannot manufacture it from the lockfile, so all three
 * route to ordinary materialization.
 */
describe('refineRemoval — a receipt that cannot witness anything', () => {
  const desiredFacets = record<NormalizedFacetEntry>([
    ['keep', { source: './vendor/keep', overrides: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } } }],
  ])
  const previousLockfile = lockfileOf([
    ['keep', entryWith([{ name: 'review', materialization: { kind: 'aliased', as: 'vendor-review' } }])],
    ['gone', entryWith([{ name: 'dropped' }])],
  ])

  test.each(['missing', 'corrupt', 'path-mismatch'] as const)('does not refine when the receipt is %s', (reason) => {
    const result = refineRemoval({
      desiredFacets,
      previousLockfile,
      lockfileExisted: true,
      receiptState: unavailable(reason),
    })

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'receipt-unwitnessable') expect.unreachable()
    expect(result.reason.reason).toBe(reason)
  })
})

/**
 * The configuration half of the same proof.
 *
 * A removal writes nothing, so every question it asks about MCP servers has
 * to be answerable from the receipt's own claims. Where it is not — the
 * receipt predates claims, the manifest asks for something the claims do not
 * record, or the claims disagree with each other — the operation falls back
 * to ordinary resolution rather than guessing.
 */
describe('refineRemoval — configuration claims', () => {
  const FINGERPRINT: McpServerFingerprint = `sha256:${'b'.repeat(64)}`

  function withClaims(
    entry: CurrentLockfileFacet,
    claims: ReadonlyArray<{
      name: string
      materialization: ReceiptFacetEntry['configurations'][number]['materialization']
    }>,
  ): ReceiptFacetEntry {
    return receiptEntryForLockedFacet(
      entry,
      claims.map((claim) => ({
        kind: 'mcp-server' as const,
        name: claim.name,
        materialization: claim.materialization,
        fingerprint: FINGERPRINT,
      })),
    )
  }

  const previousLockfile = lockfileOf([
    ['keep', entryWith([{ name: 'review' }])],
    ['gone', entryWith([{ name: 'dropped' }])],
  ])

  function stateOf(keep: ReceiptFacetEntry, gone?: ReceiptFacetEntry): ProjectReceiptState {
    const entries: Array<[string, ReceiptFacetEntry]> = [['keep', keep]]
    if (gone !== undefined) entries.push(['gone', gone])
    return loaded({ version: CURRENT_RECEIPT_VERSION, path: '/tmp/project', facets: record(entries) })
  }

  test('carries a remaining facet’s claims forward verbatim', () => {
    const keep = withClaims(previousLockfile.facets.keep as CurrentLockfileFacet, [
      { name: 'filesystem', materialization: { kind: 'authored' } },
    ])
    const result = refineRemoval({
      desiredFacets: desiredOnly(['keep']),
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep),
    })

    if (result.kind !== 'refined') expect.unreachable()
    expect(result.refinement.receiptFacets.keep?.configurations).toEqual(keep.configurations)
    // Still claimed, so nothing may be deleted.
    expect(result.refinement.obsoleteConfigurations).toEqual([])
    expect(result.refinement.retainedConfigurations.map((c) => c.identity.effectiveName)).toEqual(['filesystem'])
  })

  test('a claim only the dropped facet held becomes deletable', () => {
    const keep = withClaims(previousLockfile.facets.keep as CurrentLockfileFacet, [])
    const gone = withClaims(previousLockfile.facets.gone as CurrentLockfileFacet, [
      { name: 'filesystem', materialization: { kind: 'authored' } },
    ])
    const result = refineRemoval({
      desiredFacets: desiredOnly(['keep']),
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep, gone),
    })

    if (result.kind !== 'refined') expect.unreachable()
    expect(result.refinement.obsoleteConfigurations.map((o) => o.effectiveName)).toEqual(['filesystem'])
  })

  test('a claim a remaining facet shares with the dropped one is retained', () => {
    const keep = withClaims(previousLockfile.facets.keep as CurrentLockfileFacet, [
      { name: 'filesystem', materialization: { kind: 'authored' } },
    ])
    const gone = withClaims(previousLockfile.facets.gone as CurrentLockfileFacet, [
      { name: 'filesystem', materialization: { kind: 'authored' } },
    ])
    const result = refineRemoval({
      desiredFacets: desiredOnly(['keep']),
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep, gone),
    })

    if (result.kind !== 'refined') expect.unreachable()
    expect(result.refinement.obsoleteConfigurations).toEqual([])
  })

  test('an alias the manifest asks for but the claims do not record falls back', () => {
    const keep = withClaims(previousLockfile.facets.keep as CurrentLockfileFacet, [])
    const desiredFacets = record<NormalizedFacetEntry>([
      ['keep', { source: './vendor/keep', overrides: { servers: { filesystem: { kind: 'aliased', as: 'fs' } } } }],
    ])

    const result = refineRemoval({
      desiredFacets,
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep),
    })

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'remaining-server-intent-unwitnessed') expect.unreachable()
    expect(result.reason.authoredName).toBe('filesystem')
  })

  test('a claim the manifest now aliases differently falls back', () => {
    const keep = withClaims(previousLockfile.facets.keep as CurrentLockfileFacet, [
      { name: 'filesystem', materialization: { kind: 'authored' } },
    ])
    const desiredFacets = record<NormalizedFacetEntry>([
      ['keep', { source: './vendor/keep', overrides: { servers: { filesystem: { kind: 'aliased', as: 'fs' } } } }],
    ])

    const result = refineRemoval({
      desiredFacets,
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep),
    })

    if (result.kind !== 'not-applicable') expect.unreachable()
    expect(result.reason.code).toBe('remaining-server-intent-unrecorded')
  })

  test('a claim the manifest now omits falls back', () => {
    const keep = withClaims(previousLockfile.facets.keep as CurrentLockfileFacet, [
      { name: 'filesystem', materialization: { kind: 'authored' } },
    ])
    const desiredFacets = record<NormalizedFacetEntry>([
      ['keep', { source: './vendor/keep', overrides: { servers: { filesystem: { kind: 'omitted' } } } }],
    ])

    const result = refineRemoval({
      desiredFacets,
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep),
    })

    if (result.kind !== 'not-applicable') expect.unreachable()
    expect(result.reason.code).toBe('remaining-server-intent-unrecorded')
  })

  test('an omission with no claim is consistent', () => {
    const keep = withClaims(previousLockfile.facets.keep as CurrentLockfileFacet, [])
    const desiredFacets = record<NormalizedFacetEntry>([
      ['keep', { source: './vendor/keep', overrides: { servers: { filesystem: { kind: 'omitted' } } } }],
    ])

    const result = refineRemoval({
      desiredFacets,
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep),
    })

    expect(result.kind).toBe('refined')
  })

  test('a retained identity the receipt recorded twice, differently, falls back', () => {
    // Two claims at one effective name with different fingerprints: the entry
    // on disk says whatever the last write said, and nothing here can put the
    // remaining claimant's version back.
    const keep = receiptEntryForLockedFacet(previousLockfile.facets.keep as CurrentLockfileFacet, [
      { kind: 'mcp-server', name: 'filesystem', materialization: { kind: 'authored' }, fingerprint: FINGERPRINT },
    ])
    const gone = receiptEntryForLockedFacet(previousLockfile.facets.gone as CurrentLockfileFacet, [
      {
        kind: 'mcp-server',
        name: 'filesystem',
        materialization: { kind: 'authored' },
        fingerprint: `sha256:${'c'.repeat(64)}` as McpServerFingerprint,
      },
    ])

    const result = refineRemoval({
      desiredFacets: desiredOnly(['keep']),
      previousLockfile,
      lockfileExisted: true,
      receiptState: stateOf(keep, gone),
    })

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'retained-server-identity-contested') expect.unreachable()
    expect(result.reason.effectiveName).toBe('filesystem')
  })

  test.each([1, 0.2, 0.3] as const)('a receipt at version %p cannot witness configuration', (version) => {
    const result = refineRemoval({
      desiredFacets: desiredOnly(['keep']),
      previousLockfile,
      lockfileExisted: true,
      receiptState: {
        kind: 'loaded',
        record: {
          authority: 'assets-only',
          refinedFrom: version,
          path: '/tmp/project',
          facets: record([['keep', { version: '1.0.0', assets: [] }]]),
        },
        invalidEntries: [],
      },
    })

    if (result.kind !== 'not-applicable') expect.unreachable()
    if (result.reason.code !== 'configuration-unwitnessed') expect.unreachable()
    expect(result.reason.refinedFrom).toBe(version)
  })
})
