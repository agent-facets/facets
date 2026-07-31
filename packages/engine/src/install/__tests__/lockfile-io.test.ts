import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENT_LOCKFILE_VERSION, LEGACY_LOCKFILE_VERSION, LOCKFILE_VERSION_0_2 } from '@agent-facets/protocol'
import { FACETS_LOCK_FILE, loadLockfile, writeLockfile } from '../lockfile-io.ts'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-lockfile-io-test-'))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('loadLockfile — empty/missing', () => {
  test('missing file returns a current (0.2) empty lockfile with existed=false', () => {
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(false)
    expect(result.parsed.lockfile.facets).toEqual({})
    expect(result.parsed.lockfile.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
    expect(result.parsed.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
  })
})

describe('loadLockfile — round-trip', () => {
  test('writes and reads back an identical current (0.2) lockfile', () => {
    const lockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION as typeof CURRENT_LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: {
            kind: 'git' as const,
            url: 'github:agent-facets/viper-plans#main',
            commit: 'abc123def0123456789abc123def0123456789ab',
          },
          version: '0.1.0',
          integrity: 'sha256:deadbeef',
          assets: [
            {
              scope: 'project' as const,
              type: 'skill' as const,
              name: 'planning',
              materialization: { kind: 'authored' as const },
              files: [{ path: 'skills/planning/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
            },
          ],
        },
      },
    }
    writeLockfile(projectRoot, lockfile)
    const loaded = loadLockfile(projectRoot)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) expect.unreachable()
    expect(loaded.parsed.lockfile).toEqual(lockfile)
    expect(loaded.parsed.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
  })

  test('loads a legacy-alpha (1) lockfile under the legacy schema during the compatibility window', () => {
    const legacy = {
      lockfileVersion: LEGACY_LOCKFILE_VERSION as typeof LEGACY_LOCKFILE_VERSION,
      facets: {
        'viper-plans': {
          source: {
            kind: 'git' as const,
            url: 'github:agent-facets/viper-plans#main',
            commit: 'abc123def0123456789abc123def0123456789ab',
          },
          version: '0.1.0',
          integrity: 'sha256:deadbeef',
          assets: [{ scope: 'project' as const, type: 'skill' as const, name: 'planning' }],
        },
      },
    }
    // Seeded as raw bytes, not through `writeLockfile`: the writer only
    // emits the current schema by design, so a legacy document can only
    // arrive from disk. That is exactly the case under test.
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify(legacy, null, 2))
    const loaded = loadLockfile(projectRoot)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) expect.unreachable()
    expect(loaded.parsed.lockfile).toEqual(legacy)
    expect(loaded.parsed.lockfileVersion).toBe(LEGACY_LOCKFILE_VERSION)
  })
})

describe('loadLockfile — error paths', () => {
  test('malformed JSON returns a structured error', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), '{ not valid json')
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('malformed JSON')
  })

  test('schema violation returns a structured error', () => {
    writeFileSync(
      join(projectRoot, FACETS_LOCK_FILE),
      JSON.stringify({ lockfileVersion: 1, facets: { x: { source: 'x' } } }),
    )
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('is invalid')
  })
})

// Exact version dispatch (design D10). An unsupported/unknown version must
// produce an actionable "upgrade the CLI" message, not a generic arktype
// mismatch — and dispatch is by exact equality, never numeric ordering.
describe('loadLockfile — exact version dispatch', () => {
  test('an unsupported lockfileVersion fails with an actionable error', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify({ lockfileVersion: 99, facets: {} }))
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error).toContain('unsupported lockfileVersion')
    expect(result.error).toContain('99')
    expect(result.error).toContain('Upgrade the CLI')
  })

  test('legacy-alpha version 1 loads under the legacy schema', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify({ lockfileVersion: 1, facets: {} }))
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(result.parsed.lockfileVersion).toBe(LEGACY_LOCKFILE_VERSION)
  })

  test('version 0.2 loads under the 0.2 schema, not the current one', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify({ lockfileVersion: 0.2, facets: {} }))
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(result.parsed.lockfileVersion).toBe(LOCKFILE_VERSION_0_2)
    expect(result.parsed.lockfileVersion).not.toBe(CURRENT_LOCKFILE_VERSION)
  })

  test('current version 0.3 loads under the current schema', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify({ lockfileVersion: 0.3, facets: {} }))
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(true)
    expect(result.parsed.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
  })

  test('a malformed 0.2 lockfile is not reinterpreted as legacy 1', () => {
    // `files` is required on 0.2 asset entries; omitting it is a 0.2 schema
    // violation, never a fallback to the legacy identity-only shape.
    writeFileSync(
      join(projectRoot, FACETS_LOCK_FILE),
      JSON.stringify({
        lockfileVersion: 0.2,
        facets: {
          x: {
            source: { kind: 'registry', registry: 'https://example.com' },
            version: '1.0.0',
            integrity: 'sha256:deadbeef',
            assets: [{ scope: 'project', type: 'skill', name: 'planning' }],
          },
        },
      }),
    )
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error).toContain('lockfileVersion 0.2')
  })
})

// Deterministic key ordering — top-level facet keys are sorted alphabetically
// on write so add/remove/add produces stable diffs.
describe('writeLockfile — key ordering', () => {
  /** Minimal valid facet entry for ordering tests. */
  const entry = (version: string) => ({
    source: { kind: 'git' as const, url: 'github:test/test#main', commit: 'a'.repeat(40) },
    version,
    integrity: 'sha256:0000',
    assets: [
      {
        scope: 'project' as const,
        type: 'skill' as const,
        name: 'x',
        materialization: { kind: 'authored' as const },
        files: [{ path: 'skills/x/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
      },
    ],
  })

  test('sorts top-level facet keys alphabetically', () => {
    const lockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION as typeof CURRENT_LOCKFILE_VERSION,
      facets: { zeta: entry('0.3.0'), alpha: entry('0.1.0'), mu: entry('0.2.0') },
    }
    writeLockfile(projectRoot, lockfile)
    const raw = readFileSync(join(projectRoot, FACETS_LOCK_FILE), 'utf8')
    const keys = Object.keys(JSON.parse(raw).facets)
    expect(keys).toEqual(['alpha', 'mu', 'zeta'])
  })

  test('idempotent across remove+re-add reordering', () => {
    // Simulate original order: a, b, c
    const original = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION as typeof CURRENT_LOCKFILE_VERSION,
      facets: { a: entry('0.1.0'), b: entry('0.2.0'), c: entry('0.3.0') },
    }
    writeLockfile(projectRoot, original)
    const bytesOriginal = readFileSync(join(projectRoot, FACETS_LOCK_FILE), 'utf8')

    // Simulate remove b then re-add b (b moves to end of insertion order)
    const reordered = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION as typeof CURRENT_LOCKFILE_VERSION,
      facets: { a: entry('0.1.0'), c: entry('0.3.0'), b: entry('0.2.0') },
    }
    writeLockfile(projectRoot, reordered)
    const bytesReordered = readFileSync(join(projectRoot, FACETS_LOCK_FILE), 'utf8')

    expect(bytesReordered).toBe(bytesOriginal)
  })

  test('sorted output round-trips through loadLockfile', () => {
    const lockfile = {
      lockfileVersion: CURRENT_LOCKFILE_VERSION as typeof CURRENT_LOCKFILE_VERSION,
      facets: { zeta: entry('0.3.0'), alpha: entry('0.1.0') },
    }
    writeLockfile(projectRoot, lockfile)
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.parsed.lockfile.facets.alpha).toEqual(lockfile.facets.alpha)
    expect(result.parsed.lockfile.facets.zeta).toEqual(lockfile.facets.zeta)
  })
})
