import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Lockfile02, SupportedLockfile } from '@agent-facets/protocol'
import { CURRENT_LOCKFILE_VERSION, LOCKFILE_VERSION_0_2 } from '@agent-facets/protocol'
import { buildUpdatedReceipt } from '../commit/tri-write.ts'
import {
  bootstrapReceipt,
  CURRENT_RECEIPT_VERSION,
  LEGACY_RECEIPT_VERSION,
  loadReceipt,
  RECEIPT_VERSION_0_2,
  type Receipt,
  type ReceiptAsset,
  receiptPath,
  resolveProjectReceipt,
  writeReceipt,
} from '../receipt.ts'

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
        cowsay: {
          version: '0.0.1',
          assets: [{ ...skillAsset('escape'), name: '../escape' }, skillAsset('cowsay')],
        },
        hello: {
          version: '1.0.0',
          assets: [agentAsset('greeter')],
        },
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    // The invalid entry is reported with its facet, name, and reason.
    expect(result.invalidEntries).toHaveLength(1)
    expect(result.invalidEntries[0]?.facet).toBe('cowsay')
    expect(result.invalidEntries[0]?.asset).toBe('../escape')
    expect(result.invalidEntries[0]?.reason.length).toBeGreaterThan(0)
    // The valid sibling asset and the untouched facet still load.
    expect(result.receipt.facets.cowsay?.assets).toEqual([skillAsset('cowsay')])
    expect(result.receipt.facets.hello?.assets).toHaveLength(1)
  })

  test('drops an asset whose owned file path escapes, reporting it', () => {
    // Untrusted-input containment: a crafted owned PATH (not name) must drop
    // the whole asset record — never delete an escaping path — while valid
    // siblings still load.
    const receipt: Receipt = {
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
              materialization: { kind: 'authored' },
              files: ['skills/cowsay/../../escape.md'],
            },
            skillAsset('safe'),
          ],
        },
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    expect(result.invalidEntries).toHaveLength(1)
    expect(result.invalidEntries[0]?.asset).toBe('cowsay')
    expect(result.invalidEntries[0]?.reason).toContain('owned path')
    expect(result.receipt.facets.cowsay?.assets).toEqual([skillAsset('safe')])
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
    expect(result.receipt.version).toBe(CURRENT_RECEIPT_VERSION)
    expect(result.receipt.facets.cowsay?.assets).toEqual([skillAsset('cowsay'), commandAsset('moo')])
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
    expect(result.receipt.version).toBe(CURRENT_RECEIPT_VERSION)
    expect(result.receipt.facets.cowsay?.assets[0]?.materialization).toEqual({ kind: 'authored' })
    expect(result.receipt.facets.cowsay?.assets[0]?.files).toEqual([
      'skills/cowsay/SKILL.md',
      'skills/cowsay/references/art.md',
    ])
  })

  test('a current receipt round-trips an aliased disposition', () => {
    const receipt: Receipt = {
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
              materialization: { kind: 'aliased', as: 'vendor-cowsay' },
              files: ['skills/cowsay/SKILL.md'],
            },
          ],
        },
      },
    }
    const path = receiptPath(projectDir)
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(path, JSON.stringify(receipt))
    const result = loadReceipt(projectDir)
    if (!result.ok) expect.unreachable()
    // Both names survive: authored anchors ownership and canonical paths,
    // the alias is what the adapter must be asked to delete.
    expect(result.receipt.facets.cowsay?.assets[0]?.name).toBe('cowsay')
    expect(result.receipt.facets.cowsay?.assets[0]?.materialization).toEqual({
      kind: 'aliased',
      as: 'vendor-cowsay',
    })
    expect(result.receipt.facets.cowsay?.assets[0]?.files).toEqual(['skills/cowsay/SKILL.md'])
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
        cowsay: {
          version: '0.0.1',
          assets: [skillAsset('cowsay')],
        },
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
        cowsay: {
          version: '0.0.1',
          assets: [skillAsset('cowsay')],
        },
      },
    }
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.receipt.facets.cowsay?.version).toBe('0.0.1')
    expect(result.receipt.facets.cowsay?.assets).toHaveLength(1)
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
        cowsay: {
          version: '0.0.1',
          assets: [skillAsset('cowsay'), commandAsset('moo')],
        },
        hello: {
          version: '1.0.0',
          assets: [agentAsset('greeter')],
        },
      },
    }
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(Object.keys(result.receipt.facets)).toHaveLength(2)
    expect(result.receipt.facets.cowsay?.assets).toHaveLength(2)
    expect(result.receipt.facets.hello?.assets).toHaveLength(1)
  })

  test('normalizes receipt.path so a stale path does not cause path-mismatch (#20)', () => {
    const canonical = realpathSync(projectDir)
    const receipt: Receipt = {
      version: CURRENT_RECEIPT_VERSION,
      path: '/some/other/path', // intentionally wrong
      facets: {
        cowsay: {
          version: '0.0.1',
          assets: [skillAsset('cowsay')],
        },
      },
    }
    writeReceipt(projectDir, receipt)
    const result = loadReceipt(projectDir)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.receipt.path).toBe(canonical)
  })
})

// ---------------------------------------------------------------------------
// bootstrapReceipt
// ---------------------------------------------------------------------------

describe('bootstrapReceipt', () => {
  test('creates a current receipt from a 0.2 lockfile', () => {
    const lockfile: Lockfile02 = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
          version: '0.0.1',
          integrity: 'sha256:abc',
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: 'cowsay',
              files: [{ path: 'skills/cowsay/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
            },
            {
              scope: 'project',
              type: 'command',
              name: 'moo',
              files: [{ path: 'commands/moo.md', integrity: `sha256:${'1'.repeat(64)}` }],
            },
          ],
        },
      },
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    expect(receipt.version).toBe(CURRENT_RECEIPT_VERSION)
    expect(receipt.path).toBe(realpathSync(projectDir))
    expect(receipt.facets.cowsay?.version).toBe('0.0.1')
    // Ownership comes from the entry's own `files`, which every supported
    // lockfile version carries.
    expect(receipt.facets.cowsay?.assets).toEqual([skillAsset('cowsay'), commandAsset('moo')])
  })

  test('mirrors owned companion paths from a 0.2 lockfile and refines to authored', () => {
    // Pinned to 0.2 explicitly. This fixture previously claimed the CURRENT
    // version while carrying disposition-less assets — a document no reader
    // would accept — and only compiled through an `as unknown as` cast.
    const lockfile: Lockfile02 = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
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
          ],
        },
      },
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    // Receipt mirrors the owned PATHS (no hashes).
    expect(receipt.facets.cowsay?.assets[0]?.files).toEqual([
      'skills/cowsay/SKILL.md',
      'skills/cowsay/references/art.md',
    ])
    // A pre-disposition entry can only have meant authored materialization.
    expect(receipt.facets.cowsay?.assets[0]?.materialization).toEqual({ kind: 'authored' })
  })

  test('carries dispositions through from a current lockfile and excludes omitted assets', () => {
    const files = [{ path: 'skills/cowsay/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }]
    const lockfile: SupportedLockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
          version: '0.0.1',
          integrity: 'sha256:abc',
          assets: [
            { scope: 'project', type: 'skill', name: 'cowsay', materialization: { kind: 'authored' }, files },
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
        },
      },
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    // The omitted agent is absent: the lockfile records the resolved SET,
    // the receipt records only what is on disk. Bootstrapping from an
    // omitted asset would claim ownership of files never written.
    expect(receipt.facets.cowsay?.assets.map((a) => a.name)).toEqual(['cowsay', 'moo'])
    expect(receipt.facets.cowsay?.assets[1]?.materialization).toEqual({ kind: 'aliased', as: 'cow-moo' })
    // Authored paths are preserved even under an alias.
    expect(receipt.facets.cowsay?.assets[1]?.files).toEqual(['commands/moo.md'])
  })

  test('empty lockfile produces empty receipt', () => {
    const lockfile: SupportedLockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: {},
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    expect(Object.keys(receipt.facets)).toHaveLength(0)
  })

  test('strips source and integrity from lockfile entries', () => {
    const lockfile: Lockfile02 = {
      lockfileVersion: LOCKFILE_VERSION_0_2,
      facets: {
        cowsay: {
          source: { kind: 'git', url: 'https://github.com/test/cowsay', commit: 'abc12345' },
          version: '0.0.1',
          integrity: 'sha256:abc',
          assets: [
            {
              scope: 'project',
              type: 'skill',
              name: 'cowsay',
              files: [{ path: 'skills/cowsay/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
            },
          ],
        },
      },
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    // Receipt entries should not carry source or integrity.
    const entry = receipt.facets.cowsay
    expect(entry).toBeDefined()
    if (!entry) expect.unreachable()
    expect('source' in entry).toBe(false)
    expect('integrity' in entry).toBe(false)
    expect(entry.version).toBe('0.0.1')
    expect(entry.assets).toHaveLength(1)
  })

  // A dropped receipt facet is not a cosmetic loss: `buildPreviousOwnership`
  // never sees the claim, so those materialized assets are neither deleted
  // nor re-tracked. Assignment for this key creates no own member, so the
  // entry vanished silently — the one outcome D6 rules out.
  test('a facet named __proto__ becomes an own key', () => {
    const lockfile = JSON.parse(
      JSON.stringify({
        lockfileVersion: LOCKFILE_VERSION_0_2,
        facets: {
          PLACEHOLDER: {
            source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
            version: '0.0.1',
            integrity: 'sha256:abc',
            assets: [
              {
                scope: 'project',
                type: 'skill',
                name: 'cowsay',
                files: [{ path: 'skills/cowsay/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
              },
            ],
          },
        },
      }).replace('"PLACEHOLDER"', '"__proto__"'),
    ) as Lockfile02

    const receipt = bootstrapReceipt(projectDir, lockfile)

    expect(Object.hasOwn(receipt.facets, '__proto__')).toBe(true)
    expect(Object.keys(receipt.facets)).toEqual(['__proto__'])
  })
})

// ---------------------------------------------------------------------------
// resolveProjectReceipt
// ---------------------------------------------------------------------------

describe('resolveProjectReceipt', () => {
  const lockfile: SupportedLockfile = { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} }

  function writeRawReceipt(body: string): void {
    mkdirSync(join(facetDir, 'receipts'), { recursive: true })
    writeFileSync(receiptPath(projectDir), body)
  }

  test('tags a readable receipt as loaded', () => {
    writeReceipt(projectDir, {
      version: CURRENT_RECEIPT_VERSION,
      path: realpathSync(projectDir),
      facets: { cowsay: { version: '0.0.1', assets: [skillAsset('cowsay')] } },
    })

    const state = resolveProjectReceipt(projectDir, lockfile)

    if (state.kind !== 'loaded') expect.unreachable()
    expect(state.receipt.facets.cowsay?.assets).toHaveLength(1)
    expect(state.invalidEntries).toEqual([])
  })

  test('tags an absent receipt as missing', () => {
    expect(resolveProjectReceipt(projectDir, lockfile).kind).toBe('missing')
  })

  test.each([
    ['corrupt', 'not json{'],
    ['path-mismatch', JSON.stringify({ version: CURRENT_RECEIPT_VERSION, path: '/some/other/project', facets: {} })],
  ] as const)('tags a %s receipt as invalid', (reason, body) => {
    writeRawReceipt(body)

    const state = resolveProjectReceipt(projectDir, lockfile)

    if (state.kind !== 'invalid') expect.unreachable()
    expect(state.reason).toBe(reason)
    // Reconciliation still needs a receipt to diff against, so the projection
    // is supplied — under a name no witness check can consume.
    expect(state.fallback.path).toBe(realpathSync(projectDir))
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

    const updated = buildUpdatedReceipt(
      { version: CURRENT_RECEIPT_VERSION, path: realpathSync(projectDir), facets: {} },
      { kind: 'written', facetEntries: newFacetEntries },
    )

    expect(Object.hasOwn(updated.facets, '__proto__')).toBe(true)
    expect(Object.keys(updated.facets)).toEqual(['__proto__'])
  })

  // An omitted asset is in the lockfile (the resolved SET) but was never
  // written, so claiming ownership of it would make the next removal try to
  // delete a file that does not exist.
  test('an omitted asset is not recorded as materialized', () => {
    const updated = buildUpdatedReceipt(
      { version: CURRENT_RECEIPT_VERSION, path: realpathSync(projectDir), facets: {} },
      {
        kind: 'written',
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
      },
    )

    expect(updated.facets.cowsay?.assets.map((a) => a.name)).toEqual(['kept'])
  })

  // The removal-refinement path writes nothing, so it hands over the records
  // it already witnessed rather than a projection of the lockfile. Committing
  // them verbatim is the whole point: a projection would describe an
  // effective identity no file on this machine has.
  test('carried-forward records are committed verbatim', () => {
    const carried = {
      cowsay: {
        version: '1.0.0',
        assets: [
          {
            scope: 'project' as const,
            type: 'skill' as const,
            name: 'review',
            materialization: { kind: 'aliased' as const, as: 'vendor-review' },
            files: ['skills/review/SKILL.md'],
          },
        ],
      },
    }

    const updated = buildUpdatedReceipt(
      { version: CURRENT_RECEIPT_VERSION, path: realpathSync(projectDir), facets: {} },
      { kind: 'carried-forward', facets: carried },
    )

    expect(updated.facets.cowsay).toEqual(carried.cowsay)
  })

  test('a carried-forward facet named __proto__ becomes an own key', () => {
    const carried = JSON.parse(
      JSON.stringify({
        PLACEHOLDER: { version: '1.0.0', assets: [] },
      }).replace('"PLACEHOLDER"', '"__proto__"'),
    )

    const updated = buildUpdatedReceipt(
      { version: CURRENT_RECEIPT_VERSION, path: realpathSync(projectDir), facets: {} },
      { kind: 'carried-forward', facets: carried },
    )

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
    ['current', CURRENT_RECEIPT_VERSION, { version: '0.0.1', assets: [asset] }],
    ['0.2', 0.2, { version: '0.0.1', assets: [asset] }],
    ['legacy 1', 1, { version: '0.0.1', assets: [{ type: 'skill', name: 'cowsay', scope: 'project' }] }],
  ])('a %s receipt keeps a __proto__ facet as an own key', (_label, version, entry) => {
    writeRaw(version, entry)

    const result = loadReceipt(projectDir)

    if (!result.ok) expect.unreachable()
    expect(Object.hasOwn(result.receipt.facets, '__proto__')).toBe(true)
    expect(Object.keys(result.receipt.facets)).toEqual(['__proto__'])
  })
})
