import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Lockfile02, SupportedLockfile } from '@agent-facets/protocol'
import { buildPreviousOwnership } from '../commit/ownership.ts'
import { buildUpdatedReceipt } from '../commit/tri-write.ts'
import {
  CURRENT_RECEIPT_VERSION,
  LEGACY_RECEIPT_VERSION,
  loadReceipt,
  RECEIPT_VERSION_0_2,
  RECEIPT_VERSION_0_3,
  type Receipt,
  type ReceiptAsset,
  type ReceiptConfigurationClaim,
  type ReceiptFacetEntry,
  receiptEntryForLockedFacet,
  receiptPath,
  receiptProjectPath,
  resolveProjectReceipt,
  writeReceipt,
} from '../receipt.ts'

/** Placeholder facet integrity. Only its identity across a round trip matters. */
const INTEGRITY = 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

/** A configuration claim. The fingerprint stands in for a declaration. */
function claim(name: string, materialization: ReceiptConfigurationClaim['materialization'] = { kind: 'authored' }) {
  return {
    kind: 'mcp-server',
    name,
    materialization,
    fingerprint: `sha256:${'a'.repeat(64)}`,
  } satisfies ReceiptConfigurationClaim
}

/** A current facet record. Most tests care only about its assets. */
function facetEntry(
  version: string,
  assets: ReceiptAsset[],
  configurations: ReceiptConfigurationClaim[] = [],
): ReceiptFacetEntry {
  return { version, integrity: INTEGRITY, assets, configurations }
}

/** An authored-materialization skill asset owning exactly its SKILL.md. */
function skillAsset(name: string): ReceiptAsset {
  return {
    scope: 'project',
    type: 'skill',
    name,
    materialization: { kind: 'authored' },
    files: [`skills/${name}/SKILL.md`],
  }
}

/** An authored-materialization agent asset owning exactly its primary file. */
function agentAsset(name: string): ReceiptAsset {
  return {
    scope: 'project',
    type: 'agent',
    name,
    materialization: { kind: 'authored' },
    files: [`agents/${name}.md`],
  }
}

/** An authored-materialization command asset owning exactly its primary file. */
function commandAsset(name: string): ReceiptAsset {
  return {
    scope: 'project',
    type: 'command',
    name,
    materialization: { kind: 'authored' },
    files: [`commands/${name}.md`],
  }
}

let facetDir: string
let projectDir: string
let originalFacetDir: string | undefined

/** Write receipt bytes verbatim, bypassing the writer's own shaping. */
function writeRawReceipt(body: string): void {
  mkdirSync(join(facetDir, 'receipts'), { recursive: true })
  writeFileSync(receiptPath(projectDir), body)
}

beforeEach(() => {
  originalFacetDir = process.env.FACET_DIR
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'facet-receipt-test-')))
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'facet-project-')))
  process.env.FACET_DIR = facetDir
})

afterEach(() => {
  if (originalFacetDir === undefined) {
    delete process.env.FACET_DIR
  } else {
    process.env.FACET_DIR = originalFacetDir
  }
  rmSync(facetDir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// receiptPath
// ---------------------------------------------------------------------------

describe('receiptPath', () => {
  test('produces a path under $FACET_DIR/receipts/', () => {
    const path = receiptPath(projectDir)
    expect(path.startsWith(join(facetDir, 'receipts/'))).toBe(true)
    expect(path.endsWith('.json')).toBe(true)
  })

  test('same project dir produces the same path', () => {
    expect(receiptPath(projectDir)).toBe(receiptPath(projectDir))
  })

  test('different project dirs produce different paths', () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'facet-project2-')))
    try {
      expect(receiptPath(projectDir)).not.toBe(receiptPath(other))
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// loadReceipt
// ---------------------------------------------------------------------------

describe('loadReceipt', () => {
  test('returns missing when no receipt file exists', () => {
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('missing')
  })

  test('returns corrupt on invalid JSON', () => {
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, 'not json{')
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('corrupt')
  })

  test('returns corrupt on schema-invalid data', () => {
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 99, path: projectDir, facets: {} }))
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('corrupt')
  })

  test('returns path-mismatch when embedded path differs', () => {
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: '/some/other/project',
      facets: {},
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt))
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('path-mismatch')
  })

  test('extracts a path-traversal asset entry per-entry while valid entries still load', () => {
    // One invalid asset (path traversal) alongside a valid one, plus a
    // second facet that is entirely valid. The invalid entry must be
    // reported — never acted on — while everything else loads normally
    // (W2: per-entry extraction, not whole-receipt rejection).
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: facetEntry('0.0.1', [{ ...skillAsset('escape'), name: '../escape' }, skillAsset('cowsay')]),
        hello: facetEntry('1.0.0', [agentAsset('greeter')]),
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    // The invalid entry is reported with its facet, name, and reason.
    expect(result.invalidEntries).toHaveLength(1)
    const invalid = result.invalidEntries[0]
    if (invalid?.kind !== 'asset') expect.unreachable()
    expect(invalid.facet).toBe('cowsay')
    expect(invalid.asset).toBe('../escape')
    expect(invalid.reason.length).toBeGreaterThan(0)
    // The valid sibling asset and the untouched facet still load.
    expect(result.record.facets.cowsay?.assets).toEqual([skillAsset('cowsay')])
    expect(result.record.facets.hello?.assets).toHaveLength(1)
  })

  test('drops an asset whose owned file path escapes, reporting it', () => {
    // Untrusted-input containment: a crafted owned PATH (not name) must drop
    // the whole asset record — never delete an escaping path — while valid
    // siblings still load.
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: facetEntry('0.0.1', [
          {
            scope: 'project',
            type: 'skill',
            name: 'cowsay',
            materialization: { kind: 'authored' },
            files: ['skills/cowsay/../../escape.md'],
          },
          skillAsset('safe'),
        ]),
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    expect(result.invalidEntries).toHaveLength(1)
    const invalid = result.invalidEntries[0]
    if (invalid?.kind !== 'asset') expect.unreachable()
    expect(invalid.asset).toBe('cowsay')
    expect(invalid.reason).toContain('owned path')
    expect(result.record.facets.cowsay?.assets).toEqual([skillAsset('safe')])
  })

  test('refines a legacy (1) receipt to primary-only ownership', () => {
    // Legacy installs could not materialize companions, so a legacy
    // identity-only receipt is refined to the single conventional primary
    // path per asset and loads as current.
    const legacy = {
      version: LEGACY_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: {
          version: '0.0.1',
          assets: [
            { scope: 'project', type: 'skill', name: 'cowsay' },
            { scope: 'project', type: 'command', name: 'moo' },
          ],
        },
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(legacy))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    expect(result.record.authority).toBe('assets-only')
    expect(result.record.facets.cowsay?.assets).toEqual([skillAsset('cowsay'), commandAsset('moo')])
  })

  test('refines a 0.2 receipt to authored, retaining its complete ownership', () => {
    // A 0.2 receipt already records exact owned paths — including companions
    // — so refinement adds only the disposition. Losing those paths would
    // silently downgrade offline removal to primary-only.
    const receipt02 = {
      version: RECEIPT_VERSION_0_2,
      path: realpathSync(projectDir),
      facets: {
        cowsay: {
          version: '0.0.1',
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: 'cowsay',
              files: ['skills/cowsay/SKILL.md', 'skills/cowsay/references/art.md'],
            },
          ],
        },
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt02))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    expect(result.record.authority).toBe('assets-only')
    expect(result.record.facets.cowsay?.assets[0]?.materialization).toEqual({ kind: 'authored' })
    expect(result.record.facets.cowsay?.assets[0]?.files).toEqual([
      'skills/cowsay/SKILL.md',
      'skills/cowsay/references/art.md',
    ])
  })

  test('a current receipt round-trips an aliased disposition', () => {
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: facetEntry('0.0.1', [
          {
            scope: 'project',
            type: 'skill',
            name: 'cowsay',
            materialization: { kind: 'aliased', as: 'vendor-cowsay' },
            files: ['skills/cowsay/SKILL.md'],
          },
        ]),
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    // Both names survive: authored anchors ownership and canonical paths,
    // the alias is what the adapter must be asked to delete.
    expect(result.record.facets.cowsay?.assets[0]?.name).toBe('cowsay')
    expect(result.record.facets.cowsay?.assets[0]?.materialization).toEqual({
      kind: 'aliased',
      as: 'vendor-cowsay',
    })
    expect(result.record.facets.cowsay?.assets[0]?.files).toEqual(['skills/cowsay/SKILL.md'])
  })

  test('a receipt recording an omitted asset is corrupt, not silently accepted', () => {
    // The current schema admits only the two arms that put bytes on disk, so
    // "omitted but materialized" cannot be represented at all.
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        version: CURRENT_RECEIPT_VERSION,
        path: realpathSync(projectDir),
        facets: {
          cowsay: {
            version: '0.0.1',
            assets: [
              {
                scope: 'project',
                type: 'skill',
                name: 'cowsay',
                materialization: { kind: 'omitted' },
                files: ['skills/cowsay/SKILL.md'],
              },
            ],
          },
        },
      }),
    )
    const result = loadReceipt(projectDir)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('corrupt')
  })

  test('a fully valid receipt reports no invalid entries', () => {
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: facetEntry('0.0.1', [skillAsset('cowsay')]),
      },
    }
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    expect(result.invalidEntries).toEqual([])
  })

  test('loads a valid receipt successfully', () => {
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: facetEntry('0.0.1', [skillAsset('cowsay')]),
      },
    }
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.record.facets.cowsay?.version).toBe('0.0.1')
    expect(result.record.facets.cowsay?.assets).toHaveLength(1)
  })

  test('round-trips a configuration claim without recording the declaration', () => {
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: facetEntry('0.0.1', [], [claim('filesystem', { kind: 'aliased', as: 'project-filesystem' })]),
      },
    }
    writeReceipt(projectDir, receipt)

    const result = loadReceipt(projectDir)

    if (!result.ok) expect.unreachable()
    if (result.record.authority !== 'assets-and-configuration') expect.unreachable()
    expect(result.record.facets.cowsay?.configurations).toEqual([
      claim('filesystem', { kind: 'aliased', as: 'project-filesystem' }),
    ])
    // The whole point of storing a fingerprint: the file names no command,
    // no URL, and no environment data.
    const raw = readFileSync(receiptPath(projectDir), 'utf8')
    for (const secret of ['command', 'args', 'url', 'env', 'npx', 'https://']) {
      expect(raw).not.toContain(secret)
    }
  })

  // Per-entry containment, exactly as for assets: one unusable claim must not
  // withdraw authority over the rest of the file.
  test.each([
    ['a malformed server name', { ...claim('ok'), name: 'Not Valid' }],
    ['a fingerprint that is not a digest', { ...claim('ok'), fingerprint: 'sha256:nope' }],
  ])('drops %s, reporting it, while valid claims still load', (_label, bad) => {
    writeRawReceipt(
      JSON.stringify({
        version: CURRENT_RECEIPT_VERSION,
        path: realpathSync(projectDir),
        facets: {
          cowsay: { version: '0.0.1', integrity: INTEGRITY, assets: [], configurations: [bad, claim('good')] },
        },
      }),
    )

    const result = loadReceipt(projectDir)

    if (!result.ok) expect.unreachable()
    expect(result.invalidEntries).toHaveLength(1)
    const invalid = result.invalidEntries[0]
    if (invalid?.kind !== 'configuration') expect.unreachable()
    expect(invalid.facet).toBe('cowsay')
    if (result.record.authority !== 'assets-and-configuration') expect.unreachable()
    expect(result.record.facets.cowsay?.configurations).toEqual([claim('good')])
  })

  test('collapses a claim the receipt repeats verbatim', () => {
    writeRawReceipt(
      JSON.stringify({
        version: CURRENT_RECEIPT_VERSION,
        path: realpathSync(projectDir),
        facets: {
          cowsay: { version: '0.0.1', integrity: INTEGRITY, assets: [], configurations: [claim('fs'), claim('fs')] },
        },
      }),
    )

    const result = loadReceipt(projectDir)

    if (!result.ok) expect.unreachable()
    expect(result.invalidEntries).toEqual([])
    if (result.record.authority !== 'assets-and-configuration') expect.unreachable()
    expect(result.record.facets.cowsay?.configurations).toEqual([claim('fs')])
  })

  test('drops both claims when a facet contradicts itself about one server', () => {
    // File order must not get to decide which effective entry this machine
    // believes it owns, or which declaration it believes was approved.
    writeRawReceipt(
      JSON.stringify({
        version: CURRENT_RECEIPT_VERSION,
        path: realpathSync(projectDir),
        facets: {
          cowsay: {
            version: '0.0.1',
            integrity: INTEGRITY,
            assets: [],
            configurations: [claim('fs'), { ...claim('fs'), fingerprint: `sha256:${'b'.repeat(64)}` }],
          },
        },
      }),
    )

    const result = loadReceipt(projectDir)

    if (!result.ok) expect.unreachable()
    expect(result.invalidEntries).toHaveLength(1)
    const invalid = result.invalidEntries[0]
    if (invalid?.kind !== 'configuration') expect.unreachable()
    expect(invalid.server).toBe('fs')
    if (result.record.authority !== 'assets-and-configuration') expect.unreachable()
    expect(result.record.facets.cowsay?.configurations).toEqual([])
  })

  test('a claim carrying an unrecognized member is corrupt, not silently accepted', () => {
    // The closure is the whole reason a receipt can be trusted to hold no
    // secrets: an unrecognized member is exactly where one would live.
    writeRawReceipt(
      JSON.stringify({
        version: CURRENT_RECEIPT_VERSION,
        path: realpathSync(projectDir),
        facets: {
          cowsay: {
            version: '0.0.1',
            integrity: INTEGRITY,
            assets: [],
            configurations: [{ ...claim('fs'), command: 'npx' }],
          },
        },
      }),
    )

    const result = loadReceipt(projectDir)

    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('corrupt')
  })

  test('returns corrupt (not throw) on an unresolvable project path (#19)', () => {
    const nonexistent = join(projectDir, 'this-does-not-exist')
    const result = loadReceipt(nonexistent)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.reason).toBe('corrupt')
  })
})

// ---------------------------------------------------------------------------
// writeReceipt + loadReceipt round-trip
// ---------------------------------------------------------------------------

describe('writeReceipt', () => {
  test('creates the receipts directory if it does not exist', () => {
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {},
    }
    // receipts/ dir doesn't exist yet
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(true)
  })

  test('round-trips a receipt with multiple facets', () => {
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: {
        cowsay: facetEntry('0.0.1', [skillAsset('cowsay'), commandAsset('moo')]),
        hello: facetEntry('1.0.0', [agentAsset('greeter')]),
      },
    }
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(Object.keys(result.record.facets)).toHaveLength(2)
    expect(result.record.facets.cowsay?.assets).toHaveLength(2)
    expect(result.record.facets.hello?.assets).toHaveLength(1)
  })

  test('normalizes receipt.path so a stale path does not cause path-mismatch (#20)', () => {
    const canonical = realpathSync(projectDir)
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: '/some/other/path', // intentionally wrong
      facets: {
        cowsay: facetEntry('0.0.1', [skillAsset('cowsay')]),
      },
    }
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.record.path).toBe(canonical)
  })
})

// ---------------------------------------------------------------------------
// receiptEntryForLockedFacet
// ---------------------------------------------------------------------------

/**
 * The lockfile-entry → receipt-entry projection, which only the `written`
 * commit arm may use: those entries describe assets the run just materialized,
 * so reading ownership off them is an observation rather than a claim.
 */
describe('receiptEntryForLockedFacet', () => {
  test('mirrors owned paths and refines a 0.2 entry to authored', () => {
    const entry: Lockfile02['facets'][string] = {
      source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
      version: '0.0.1',
      integrity: 'sha256:abc',
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'cowsay',
          files: [
            { path: 'skills/cowsay/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` },
            { path: 'skills/cowsay/references/art.md', integrity: `sha256:${'1'.repeat(64)}` },
          ],
        },
        {
          scope: 'project',
          type: 'command',
          name: 'moo',
          files: [{ path: 'commands/moo.md', integrity: `sha256:${'1'.repeat(64)}` }],
        },
      ],
    }

    const projected = receiptEntryForLockedFacet(entry, [])

    expect(projected.version).toBe('0.0.1')
    // Paths are mirrored; the hashes are not part of what a receipt records.
    expect(projected.assets[0]?.files).toEqual(['skills/cowsay/SKILL.md', 'skills/cowsay/references/art.md'])
    // A pre-disposition entry can only have meant authored materialization.
    expect(projected.assets[0]?.materialization).toEqual({ kind: 'authored' })
    expect(projected.assets[1]).toEqual(commandAsset('moo'))
    // Provenance belongs to the lockfile, never the receipt. Integrity does
    // travel — it is what anchors the entry's claims to an exact resolved
    // facet — but the source that produced it does not.
    expect('source' in projected).toBe(false)
    expect(projected.integrity).toBe('sha256:abc')
    // A run that reconciled no configuration claims records none.
    expect(projected.configurations).toEqual([])
  })

  test('carries dispositions through and excludes omitted assets', () => {
    const entry: SupportedLockfile['facets'][string] = {
      source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
      version: '0.0.1',
      integrity: 'sha256:abc',
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'cowsay',
          materialization: { kind: 'authored' },
          files: [{ path: 'skills/cowsay/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
        },
        {
          scope: 'project',
          type: 'command',
          name: 'moo',
          materialization: { kind: 'aliased', as: 'cow-moo' },
          files: [{ path: 'commands/moo.md', integrity: `sha256:${'1'.repeat(64)}` }],
        },
        {
          scope: 'project',
          type: 'agent',
          name: 'herder',
          materialization: { kind: 'omitted' },
          files: [{ path: 'agents/herder.md', integrity: `sha256:${'2'.repeat(64)}` }],
        },
      ],
    }

    const projected = receiptEntryForLockedFacet(entry, [])

    // The omitted agent is absent: the lockfile records the resolved SET, the
    // receipt records what is on disk, and an omitted asset was never written.
    expect(projected.assets.map((a) => a.name)).toEqual(['cowsay', 'moo'])
    expect(projected.assets[1]?.materialization).toEqual({ kind: 'aliased', as: 'cow-moo' })
    // Owned paths stay anchored to the authored archive layout under an alias.
    expect(projected.assets[1]?.files).toEqual(['commands/moo.md'])
  })
})

// ---------------------------------------------------------------------------
// resolveProjectReceipt
// ---------------------------------------------------------------------------

describe('resolveProjectReceipt', () => {
  test('tags a readable receipt as loaded', () => {
    writeReceipt(projectDir, {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: { cowsay: facetEntry('0.0.1', [skillAsset('cowsay')]) },
    })

    const state = resolveProjectReceipt(projectDir)

    if (state.kind !== 'loaded') expect.unreachable()
    expect(state.record.facets.cowsay?.assets).toHaveLength(1)
    expect(state.invalidEntries).toEqual([])
  })

  // Every unusable state proves the same thing — nothing. The reason exists to
  // tell the user which one happened, not to grade how much ownership it
  // confers. The arm carries no receipt at all, so there is no field an
  // ownership claim could hide in.
  test.each([
    ['missing', undefined],
    ['corrupt', 'not json{'],
    ['path-mismatch', JSON.stringify({ version: CURRENT_RECEIPT_VERSION, path: '/some/other/project', facets: {} })],
  ] as const)('reports a %s receipt as unavailable with no claims', (reason, body) => {
    if (body !== undefined) writeRawReceipt(body)

    const state = resolveProjectReceipt(projectDir)

    if (state.kind !== 'unavailable') expect.unreachable()
    expect(state.reason).toBe(reason)
    expect(state.projectPath).toBe(realpathSync(projectDir))
    // The commit is told only where to write, so there is no field an
    // ownership claim could ride in on.
    expect(receiptProjectPath(state)).toBe(realpathSync(projectDir))
    // And it authorizes no deletion.
    expect(buildPreviousOwnership(state).size).toBe(0)
  })

  test('a loaded receipt names its own location, and its claims authorize deletion', () => {
    writeReceipt(projectDir, {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: { cowsay: facetEntry('0.0.1', [skillAsset('cowsay')]) },
    })

    const state = resolveProjectReceipt(projectDir)

    if (state.kind !== 'loaded') expect.unreachable()
    expect(receiptProjectPath(state)).toBe(realpathSync(projectDir))
    expect([...buildPreviousOwnership(state).values()].map((o) => o.effectiveName)).toEqual(['cowsay'])
  })

  // Earlier versions keep every file they ever owned, and gain nothing they
  // could not have witnessed. The two halves are reported separately because
  // they are separate authorities.
  test.each([
    [
      'legacy 1',
      LEGACY_RECEIPT_VERSION,
      { version: '0.0.1', assets: [{ scope: 'project', type: 'skill', name: 'cowsay' }] },
    ],
    [
      '0.2',
      RECEIPT_VERSION_0_2,
      {
        version: '0.0.1',
        assets: [{ scope: 'project', type: 'skill', name: 'cowsay', files: ['skills/cowsay/SKILL.md'] }],
      },
    ],
    ['0.3', RECEIPT_VERSION_0_3, { version: '0.0.1', assets: [skillAsset('cowsay')] }],
  ] as const)('a %s receipt keeps asset authority and confers no configuration authority', (_label, version, entry) => {
    writeRawReceipt(JSON.stringify({ version, path: realpathSync(projectDir), facets: { cowsay: entry } }))

    const state = resolveProjectReceipt(projectDir)

    if (state.kind !== 'loaded') expect.unreachable()
    if (state.record.authority !== 'assets-only') expect.unreachable()
    expect(state.record.refinedFrom).toBe(version)
    // Full deletion authority over the files it recorded.
    expect([...buildPreviousOwnership(state).values()].map((o) => o.effectiveName)).toEqual(['cowsay'])
    // And no claim field at all — not an empty one.
    expect('configurations' in (state.record.facets.cowsay ?? {})).toBe(false)
  })
})

describe('buildUpdatedReceipt', () => {
  // The commit's own rebuild of the facet map, one hop after the lockfile's.
  // On the removal-refinement path its keys come straight from local state
  // without ever passing through facet-name validation.
  test('a facet named __proto__ becomes an own key', () => {
    const newFacetEntries = JSON.parse(
      JSON.stringify({
        PLACEHOLDER: {
          source: { kind: 'local', path: './vendor/x' },
          version: '1.0.0',
          integrity: 'sha256:abc',
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: 'cowsay',
              materialization: { kind: 'authored' },
              files: [{ path: 'skills/cowsay/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
            },
          ],
        },
      }).replace('"PLACEHOLDER"', '"__proto__"'),
    )

    const updated = buildUpdatedReceipt(realpathSync(projectDir), {
      kind: 'written',
      facetEntries: newFacetEntries,
      configurations: {},
    })

    expect(Object.hasOwn(updated.facets, '__proto__')).toBe(true)
    expect(Object.keys(updated.facets)).toEqual(['__proto__'])
  })

  // An omitted asset is in the lockfile (the resolved SET) but was never
  // written, so claiming ownership of it would make the next removal try to
  // delete a file that does not exist.
  test('an omitted asset is not recorded as materialized', () => {
    const updated = buildUpdatedReceipt(realpathSync(projectDir), {
      kind: 'written',
      configurations: {},
      facetEntries: {
        cowsay: {
          source: { kind: 'local', path: './vendor/cowsay' },
          version: '1.0.0',
          integrity: 'sha256:abc',
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: 'kept',
              materialization: { kind: 'authored' },
              files: [{ path: 'skills/kept/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
            },
            {
              scope: 'project',
              type: 'skill',
              name: 'dropped',
              materialization: { kind: 'omitted' },
              files: [{ path: 'skills/dropped/SKILL.md', integrity: `sha256:${'1'.repeat(64)}` }],
            },
          ],
        },
      },
    })

    expect(updated.facets.cowsay?.assets.map((a) => a.name)).toEqual(['kept'])
  })

  // The removal-refinement path writes nothing, so it hands over the records
  // it already witnessed rather than a projection of the lockfile. Committing
  // them verbatim is the whole point: a projection would describe an
  // effective identity no file on this machine has.
  test('carried-forward records are committed verbatim', () => {
    const carried = {
      cowsay: facetEntry('1.0.0', [
        {
          scope: 'project' as const,
          type: 'skill' as const,
          name: 'review',
          materialization: { kind: 'aliased' as const, as: 'vendor-review' },
          files: ['skills/review/SKILL.md'],
        },
      ]),
    }

    const updated = buildUpdatedReceipt(realpathSync(projectDir), { kind: 'carried-forward', facets: carried })

    expect(updated.facets.cowsay).toEqual(carried.cowsay)
  })

  test('a carried-forward facet named __proto__ becomes an own key', () => {
    const carried = JSON.parse(
      JSON.stringify({
        PLACEHOLDER: { version: '1.0.0', assets: [] },
      }).replace('"PLACEHOLDER"', '"__proto__"'),
    )

    const updated = buildUpdatedReceipt(realpathSync(projectDir), { kind: 'carried-forward', facets: carried })

    expect(Object.hasOwn(updated.facets, '__proto__')).toBe(true)
    expect(Object.keys(updated.facets)).toEqual(['__proto__'])
  })
})

describe('loadReceipt — facet keys that collide with Object.prototype', () => {
  const asset = {
    scope: 'project',
    type: 'skill',
    name: 'cowsay',
    materialization: { kind: 'authored' },
    files: ['skills/cowsay/SKILL.md'],
  }

  /** Write a receipt from raw text so `__proto__` lands as an own member. */
  function writeRaw(version: number, entry: unknown): void {
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    const raw = JSON.stringify({
      version,
      path: realpathSync(projectDir),
      facets: { PLACEHOLDER: entry },
    }).replace('"PLACEHOLDER"', '"__proto__"')
    writeFileSync(receiptPath(projectDir), raw)
  }

  // Every version arm rebuilds the facet map, and each did it by assignment.
  test.each([
    [
      'current',
      CURRENT_RECEIPT_VERSION,
      { version: '0.0.1', integrity: INTEGRITY, assets: [asset], configurations: [] },
    ],
    ['0.3', RECEIPT_VERSION_0_3, { version: '0.0.1', assets: [asset] }],
    ['0.2', RECEIPT_VERSION_0_2, { version: '0.0.1', assets: [asset] }],
    [
      'legacy 1',
      LEGACY_RECEIPT_VERSION,
      { version: '0.0.1', assets: [{ type: 'skill', name: 'cowsay', scope: 'project' }] },
    ],
  ])('a %s receipt keeps a __proto__ facet as an own key', (_label, version, entry) => {
    writeRaw(version, entry)

    const result = loadReceipt(projectDir)

    if (!result.ok) expect.unreachable()
    expect(Object.hasOwn(result.record.facets, '__proto__')).toBe(true)
    expect(Object.keys(result.record.facets)).toEqual(['__proto__'])
  })
})
