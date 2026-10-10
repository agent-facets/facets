import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  computeMcpServerFingerprint,
  deriveLockedMcpInventory,
  type McpServerDeclaration,
  type McpServerFingerprint,
  parseLockfileDocument,
} from '@agent-facets/protocol'

/**
 * The consumer-owned verification workflow, using only the public entrypoint.
 *
 * An exporter holds the portable declarations it actually wrote. It reads the
 * committed lockfile, derives the selected inventory, fingerprints its own
 * exports independently, and compares the complete effective-name/fingerprint
 * sets. The comparison lives here, in the consumer, on purpose: the protocol
 * publishes derivation and fingerprinting, not a comparison API.
 *
 * Agreement proves only that the exports match a trusted lockfile. It is not
 * evidence that the lockfile is authentic or that anything was installed.
 */

const FILESYSTEM: McpServerDeclaration = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@example/server-filesystem', '/workspace'],
  env: { ROOT: '/workspace', MODE: 'read-only' },
}
const DOCS: McpServerDeclaration = { type: 'http', url: 'https://docs.example/mcp' }
const SCRATCH: McpServerDeclaration = { type: 'stdio', command: 'scratch-mcp' }

const HASH = (char: string) => `sha256:${char.repeat(64)}`

/** A committed `0.4` lockfile, as bytes, the way a consumer receives it. */
function lockfileText(): string {
  return JSON.stringify({
    lockfileVersion: 0.4,
    facets: {
      alpha: {
        source: { kind: 'registry', registry: 'https://cafe.example' },
        version: '1.2.0',
        integrity: HASH('a'),
        assets: [],
        servers: [
          {
            name: 'filesystem',
            fingerprint: computeMcpServerFingerprint(FILESYSTEM),
            materialization: { kind: 'aliased', as: 'workspace-files' },
          },
        ],
      },
      beta: {
        source: { kind: 'git', url: 'https://git.example/team/beta.git', commit: 'abcdef0123456789' },
        version: '0.3.1',
        integrity: HASH('b'),
        assets: [],
        servers: [
          { name: 'docs', fingerprint: computeMcpServerFingerprint(DOCS), materialization: { kind: 'authored' } },
          // The same declaration under another authored name, selected at the
          // same effective identity: one server, two origins, no winner.
          {
            name: 'files',
            fingerprint: computeMcpServerFingerprint(FILESYSTEM),
            materialization: { kind: 'aliased', as: 'workspace-files' },
          },
        ],
      },
      gamma: {
        source: { kind: 'local', path: '../gamma' },
        version: '0.1.0',
        integrity: HASH('c'),
        assets: [],
        servers: [
          { name: 'scratch', fingerprint: computeMcpServerFingerprint(SCRATCH), materialization: { kind: 'omitted' } },
        ],
      },
    },
  })
}

/** What the exporter actually wrote: effective name to portable declaration. */
const EXPORTS: Readonly<Record<string, McpServerDeclaration>> = {
  'workspace-files': FILESYSTEM,
  docs: DOCS,
}

type Comparison =
  | { ok: true }
  | { ok: false; reason: 'unreadable' | 'inventory-unavailable' | 'collision' }
  | {
      ok: false
      reason: 'mismatch'
      missing: string[]
      unexpected: string[]
      changed: string[]
    }

/**
 * The consumer's comparison. Every expected fingerprint comes from the
 * lockfile, every observed one is recomputed from an exported value — never
 * copied from the expectation, which would compare nothing.
 */
function compareExports(text: string, exported: Readonly<Record<string, McpServerDeclaration>>): Comparison {
  const parsed = parseLockfileDocument(text)
  if (!parsed.ok) return { ok: false, reason: 'unreadable' }
  const inventory = deriveLockedMcpInventory(parsed.data.lockfile)
  if (!inventory.ok) return { ok: false, reason: inventory.reason }

  const expected = new Map<string, McpServerFingerprint>(
    inventory.servers.map((server) => [server.effectiveName, server.fingerprint]),
  )
  const observed = new Map<string, McpServerFingerprint>(
    Object.entries(exported).map(([name, declaration]) => [name, computeMcpServerFingerprint(declaration)]),
  )

  const missing = [...expected.keys()].filter((name) => !observed.has(name)).sort()
  const unexpected = [...observed.keys()].filter((name) => !expected.has(name)).sort()
  const changed = [...expected]
    .filter(([name, fingerprint]) => observed.has(name) && observed.get(name) !== fingerprint)
    .map(([name]) => name)
    .sort()

  if (missing.length + unexpected.length + changed.length === 0) return { ok: true }
  return { ok: false, reason: 'mismatch', missing, unexpected, changed }
}

// Offline by construction: nothing here may reach for the network. A stubbed
// `fetch` that records calls makes that a checked property, not a hope.
const realFetch = globalThis.fetch
let fetchCalls = 0
beforeEach(() => {
  fetchCalls = 0
  globalThis.fetch = (() => {
    fetchCalls++
    throw new Error('network access is not part of offline verification')
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  expect(fetchCalls).toBe(0)
})

describe('consumer-owned export verification', () => {
  test('exports that match the locked selection agree', () => {
    expect(compareExports(lockfileText(), EXPORTS)).toEqual({ ok: true })
  })

  test('the derived inventory carries every origin and the omitted record', () => {
    const parsed = parseLockfileDocument(lockfileText())
    if (!parsed.ok) expect.unreachable()
    const inventory = deriveLockedMcpInventory(parsed.data.lockfile)
    if (!inventory.ok) expect.unreachable()

    const shared = inventory.servers.find((server) => server.effectiveName === 'workspace-files')
    expect(shared?.origins.map((origin) => [origin.facet, origin.authoredName, origin.version])).toEqual([
      ['alpha', 'filesystem', '1.2.0'],
      ['beta', 'files', '0.3.1'],
    ])
    expect(shared?.origins.map((origin) => origin.source.kind)).toEqual(['registry', 'git'])
    // Omitted: authored, so it is accounted for, but never selected.
    expect(
      inventory.authored.map((record) => [record.facet, record.authoredName, record.materialization.kind]),
    ).toEqual([
      ['alpha', 'filesystem', 'aliased'],
      ['beta', 'docs', 'authored'],
      ['beta', 'files', 'aliased'],
      ['gamma', 'scratch', 'omitted'],
    ])
    expect(inventory.servers.map((server) => server.effectiveName)).toEqual(['docs', 'workspace-files'])
  })

  test('reordered arguments are a different declaration', () => {
    const args = FILESYSTEM.type === 'stdio' ? [...(FILESYSTEM.args ?? [])].reverse() : []
    const result = compareExports(lockfileText(), {
      ...EXPORTS,
      'workspace-files': { ...FILESYSTEM, args } as McpServerDeclaration,
    })
    expect(result).toEqual({ ok: false, reason: 'mismatch', missing: [], unexpected: [], changed: ['workspace-files'] })
  })

  test('environment order alone is not a change', () => {
    const result = compareExports(lockfileText(), {
      ...EXPORTS,
      'workspace-files': { ...FILESYSTEM, env: { MODE: 'read-only', ROOT: '/workspace' } } as McpServerDeclaration,
    })
    expect(result).toEqual({ ok: true })
  })

  test('a dropped selected server is missing', () => {
    const result = compareExports(lockfileText(), { 'workspace-files': FILESYSTEM })
    expect(result).toEqual({ ok: false, reason: 'mismatch', missing: ['docs'], unexpected: [], changed: [] })
  })

  test('an extra server, including an omitted one, is unexpected', () => {
    const result = compareExports(lockfileText(), { ...EXPORTS, scratch: SCRATCH })
    expect(result).toEqual({ ok: false, reason: 'mismatch', missing: [], unexpected: ['scratch'], changed: [] })
  })

  test('exporting under the authored name rather than the alias disagrees', () => {
    const result = compareExports(lockfileText(), { filesystem: FILESYSTEM, docs: DOCS })
    expect(result).toEqual({
      ok: false,
      reason: 'mismatch',
      missing: ['workspace-files'],
      unexpected: ['filesystem'],
      changed: [],
    })
  })

  test('a legacy lockfile is unavailable, never an empty agreement', () => {
    const legacy = JSON.stringify({ lockfileVersion: 0.3, facets: {} })
    expect(compareExports(legacy, {})).toEqual({ ok: false, reason: 'inventory-unavailable' })
  })

  test('a conflicting lockfile selects nothing to compare against', () => {
    const document = JSON.parse(lockfileText())
    document.facets.beta.servers[1].fingerprint = computeMcpServerFingerprint(SCRATCH)
    expect(compareExports(JSON.stringify(document), EXPORTS)).toEqual({ ok: false, reason: 'collision' })
  })

  test('an empty current inventory agrees only with empty exports', () => {
    const empty = JSON.stringify({ lockfileVersion: 0.4, facets: {} })
    expect(compareExports(empty, {})).toEqual({ ok: true })
    expect(compareExports(empty, { docs: DOCS })).toEqual({
      ok: false,
      reason: 'mismatch',
      missing: [],
      unexpected: ['docs'],
      changed: [],
    })
  })
})
