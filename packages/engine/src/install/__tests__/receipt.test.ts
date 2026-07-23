import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Lockfile } from '@agent-facets/protocol'
import { CURRENT_LOCKFILE_VERSION, LEGACY_LOCKFILE_VERSION } from '@agent-facets/protocol'
import {
  bootstrapReceipt,
  CURRENT_RECEIPT_VERSION,
  loadReceipt,
  type Receipt,
  receiptPath,
  writeReceipt,
} from '../receipt.ts'

/** A current (0.2) receipt skill asset owning exactly its SKILL.md. */
function skillAsset(name: string): { scope: 'project'; type: 'skill'; name: string; files: string[] } {
  return { scope: 'project', type: 'skill', name, files: [`skills/${name}/SKILL.md`] }
}

/** A current (0.2) receipt agent asset owning exactly its primary file. */
function agentAsset(name: string): { scope: 'project'; type: 'agent'; name: string; files: string[] } {
  return { scope: 'project', type: 'agent', name, files: [`agents/${name}.md`] }
}

/** A current (0.2) receipt command asset owning exactly its primary file. */
function commandAsset(name: string): { scope: 'project'; type: 'command'; name: string; files: string[] } {
  return { scope: 'project', type: 'command', name, files: [`commands/${name}.md`] }
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
            { scope: 'project', type: 'skill', name: 'cowsay', files: ['skills/cowsay/../../escape.md'] },
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
      version: LEGACY_LOCKFILE_VERSION,
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
  test('creates a current (0.2) receipt from a legacy lockfile, primary-only', () => {
    const lockfile: Lockfile = {
      lockfileVersion: LEGACY_LOCKFILE_VERSION,
      facets: {
        cowsay: {
          source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
          version: '0.0.1',
          integrity: 'sha256:abc',
          assets: [
            { scope: 'project', type: 'skill', name: 'cowsay' },
            { scope: 'project', type: 'command', name: 'moo' },
          ],
        },
      },
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    expect(receipt.version).toBe(CURRENT_RECEIPT_VERSION)
    expect(receipt.path).toBe(realpathSync(projectDir))
    expect(receipt.facets.cowsay?.version).toBe('0.0.1')
    // Legacy identity-only assets seed their single conventional primary path.
    expect(receipt.facets.cowsay?.assets).toEqual([skillAsset('cowsay'), commandAsset('moo')])
  })

  test('mirrors owned companion paths from a 0.2 lockfile', () => {
    const lockfile: Lockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
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
          ] as unknown as Lockfile['facets'][string]['assets'],
        },
      },
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    // Receipt mirrors the owned PATHS (no hashes).
    expect(receipt.facets.cowsay?.assets[0]?.files).toEqual([
      'skills/cowsay/SKILL.md',
      'skills/cowsay/references/art.md',
    ])
  })

  test('empty lockfile produces empty receipt', () => {
    const lockfile: Lockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: {},
    }
    const receipt = bootstrapReceipt(projectDir, lockfile)
    expect(Object.keys(receipt.facets)).toHaveLength(0)
  })

  test('strips source and integrity from lockfile entries', () => {
    const lockfile: Lockfile = {
      lockfileVersion: LEGACY_LOCKFILE_VERSION,
      facets: {
        cowsay: {
          source: { kind: 'git', url: 'https://github.com/test/cowsay', commit: 'abc123' },
          version: '0.0.1',
          integrity: 'sha256:abc',
          assets: [{ scope: 'project', type: 'skill', name: 'cowsay' }],
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
})
