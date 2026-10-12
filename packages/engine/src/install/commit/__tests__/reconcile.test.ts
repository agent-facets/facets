import { describe, expect, test } from 'bun:test'
import {
  type AuthoredServer,
  computeMcpServerFingerprint,
  type McpServerDeclaration,
  parseLockfileDocument,
  type SupportedLockfile,
} from '@agent-facets/protocol'
import { reconcileLockedServerInventory } from '../reconcile.ts'

/**
 * Same-integrity server-inventory reconciliation (design D4), against
 * schema-valid lockfiles of every readable version.
 */

const INTEGRITY = `sha256:${'f'.repeat(64)}`
const OTHER_INTEGRITY = `sha256:${'e'.repeat(64)}`

const FS: McpServerDeclaration = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] }
const DOCS: McpServerDeclaration = { type: 'http', url: 'https://docs.example/mcp' }
const CHANGED: McpServerDeclaration = { type: 'stdio', command: 'npx', args: ['server-filesystem', '-y'] }

type Disposition = { kind: 'authored' } | { kind: 'aliased'; as: string } | { kind: 'omitted' }

function record(name: string, declaration: McpServerDeclaration, materialization: Disposition = { kind: 'authored' }) {
  return { name, fingerprint: computeMcpServerFingerprint(declaration), materialization }
}

function parse(document: unknown): SupportedLockfile {
  const result = parseLockfileDocument(JSON.stringify(document))
  if (!result.ok) expect.unreachable()
  return result.data.lockfile
}

function lock04(servers: unknown[], integrity = INTEGRITY): SupportedLockfile {
  return parse({
    lockfileVersion: 0.4,
    facets: {
      alpha: { source: { kind: 'local', path: './alpha' }, version: '1.0.0', integrity, assets: [], servers },
    },
  })
}

function verified(...entries: Array<[string, McpServerDeclaration]>): AuthoredServer[] {
  return entries.map(([name, declaration]) => ({ name, declaration }))
}

describe('reconcileLockedServerInventory — agreement', () => {
  test('a matching inventory passes', () => {
    const lock = lock04([record('docs', DOCS), record('fs', FS)])
    expect(
      reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['docs', DOCS], ['fs', FS])),
    ).toBeUndefined()
  })

  test('an empty inventory passes against a facet with no servers', () => {
    expect(reconcileLockedServerInventory('alpha', lock04([]), INTEGRITY, [])).toBeUndefined()
  })

  test('dispositions are intent, not content: any recorded arm passes', () => {
    for (const materialization of [{ kind: 'omitted' }, { kind: 'aliased', as: 'files' }] as Disposition[]) {
      const lock = lock04([record('fs', FS, materialization)])
      expect(reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', FS]))).toBeUndefined()
    }
  })
})

describe('reconcileLockedServerInventory — when it does not apply', () => {
  test('a changed facet integrity is a legitimate update, not a mismatch', () => {
    const lock = lock04([record('gone', FS)], OTHER_INTEGRITY)
    expect(reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', CHANGED]))).toBeUndefined()
  })

  test('a facet with no previous entry has nothing to reconcile', () => {
    expect(reconcileLockedServerInventory('beta', lock04([record('fs', FS)]), INTEGRITY, [])).toBeUndefined()
  })

  test('a legacy servers lookalike is never treated as an inventory', () => {
    for (const lockfileVersion of [0.2, 0.3]) {
      const legacy = parse({
        lockfileVersion,
        facets: {
          alpha: {
            source: { kind: 'local', path: './alpha' },
            version: '1.0.0',
            integrity: INTEGRITY,
            assets: [],
            servers: [{ name: 'gone', fingerprint: `sha256:${'0'.repeat(64)}`, materialization: { kind: 'authored' } }],
          },
        },
      })
      expect(reconcileLockedServerInventory('alpha', legacy, INTEGRITY, verified(['fs', FS]))).toBeUndefined()
    }
  })

  test('an inherited property name is not a previous entry', () => {
    expect(reconcileLockedServerInventory('constructor', lock04([]), INTEGRITY, verified(['fs', FS]))).toBeUndefined()
  })
})

describe('reconcileLockedServerInventory — authored-name set', () => {
  test('a locked name absent from content is missing', () => {
    const lock = lock04([record('fs', FS), record('gone', DOCS)])
    expect(reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', FS]))).toEqual({
      code: 'RECONCILE_SERVER_IDENTITY',
      facet: 'alpha',
      missing: ['gone'],
      unexpected: [],
    })
  })

  test('a declared name absent from the lock is unexpected, not appended', () => {
    const lock = lock04([record('fs', FS)])
    expect(reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['extra', DOCS], ['fs', FS]))).toEqual({
      code: 'RECONCILE_SERVER_IDENTITY',
      facet: 'alpha',
      missing: [],
      unexpected: ['extra'],
    })
  })

  test('both directions are reported together and sorted', () => {
    const lock = lock04([record('b-gone', FS), record('a-gone', DOCS)].sort((x, y) => (x.name < y.name ? -1 : 1)))
    const result = reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['z-new', FS], ['m-new', DOCS]))
    expect(result).toEqual({
      code: 'RECONCILE_SERVER_IDENTITY',
      facet: 'alpha',
      missing: ['a-gone', 'b-gone'],
      unexpected: ['m-new', 'z-new'],
    })
  })

  test('an omitted locked record still counts toward the set', () => {
    const lock = lock04([record('fs', FS), record('gone', DOCS, { kind: 'omitted' })])
    const result = reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', FS]))
    if (result?.code !== 'RECONCILE_SERVER_IDENTITY') expect.unreachable()
    expect(result.missing).toEqual(['gone'])
  })

  test('a set difference is reported before any fingerprint difference', () => {
    const lock = lock04([record('fs', FS), record('gone', DOCS)])
    const result = reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', CHANGED]))
    expect(result?.code).toBe('RECONCILE_SERVER_IDENTITY')
  })
})

describe('reconcileLockedServerInventory — fingerprints', () => {
  test('a changed fingerprint reports the locked and recomputed values', () => {
    const lock = lock04([record('fs', FS)])
    expect(reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', CHANGED]))).toEqual({
      code: 'RECONCILE_SERVER_FINGERPRINT',
      facet: 'alpha',
      authoredName: 'fs',
      expected: computeMcpServerFingerprint(FS),
      actual: computeMcpServerFingerprint(CHANGED),
    })
  })

  test('an omitted record with a changed fingerprint fails exactly like an active one', () => {
    const lock = lock04([record('fs', FS, { kind: 'omitted' })])
    const result = reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', CHANGED]))
    if (result?.code !== 'RECONCILE_SERVER_FINGERPRINT') expect.unreachable()
    expect(result.authoredName).toBe('fs')
  })

  test('the first mismatch in authored-name order is reported, independent of input order', () => {
    const lock = lock04([record('a', FS), record('b', DOCS)])
    const servers = verified(['b', CHANGED], ['a', CHANGED])
    const result = reconcileLockedServerInventory('alpha', lock, INTEGRITY, servers)
    if (result?.code !== 'RECONCILE_SERVER_FINGERPRINT') expect.unreachable()
    expect(result.authoredName).toBe('a')
    expect(reconcileLockedServerInventory('alpha', lock, INTEGRITY, [...servers].reverse())).toEqual(result)
  })

  test('the failure carries no declaration value', () => {
    const lock = lock04([record('fs', FS)])
    const result = reconcileLockedServerInventory('alpha', lock, INTEGRITY, verified(['fs', CHANGED]))
    const serialized = JSON.stringify(result)
    for (const secret of ['npx', 'server-filesystem', 'stdio']) {
      expect(serialized).not.toContain(secret)
    }
  })
})
