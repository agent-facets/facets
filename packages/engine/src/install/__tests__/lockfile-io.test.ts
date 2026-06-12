import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FACETS_LOCK_FILE, loadLockfile, writeLockfile } from '../lockfile-io.ts'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-lockfile-io-test-'))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('loadLockfile — empty/missing', () => {
  test('missing file returns empty lockfile with existed=false', () => {
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.existed).toBe(false)
      expect(result.data.facets).toEqual({})
    }
  })
})

describe('loadLockfile — round-trip', () => {
  test('writes and reads back an identical lockfile', () => {
    const lockfile = {
      lockfileVersion: 1 as const,
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
    writeLockfile(projectRoot, lockfile)
    const loaded = loadLockfile(projectRoot)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.data).toEqual(lockfile)
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

// F9 — forward-compat guard. A lockfile from a future CLI must produce a
// clear "upgrade the CLI" message, not a generic arktype mismatch.
describe('loadLockfile — F9 forward-compat guard', () => {
  test('lockfileVersion > LOCKFILE_VERSION fails with an actionable error', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify({ lockfileVersion: 99, facets: {} }))
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('newer facet CLI')
      expect(result.error).toContain('lockfileVersion 99')
      expect(result.error).toContain('Upgrade the CLI')
    }
  })

  test('lockfileVersion equal to LOCKFILE_VERSION loads normally', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify({ lockfileVersion: 1, facets: {} }))
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.existed).toBe(true)
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
    assets: [{ scope: 'project' as const, type: 'skill' as const, name: 'x' }],
  })

  test('sorts top-level facet keys alphabetically', () => {
    const lockfile = {
      lockfileVersion: 1 as const,
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
      lockfileVersion: 1 as const,
      facets: { a: entry('0.1.0'), b: entry('0.2.0'), c: entry('0.3.0') },
    }
    writeLockfile(projectRoot, original)
    const bytesOriginal = readFileSync(join(projectRoot, FACETS_LOCK_FILE), 'utf8')

    // Simulate remove b then re-add b (b moves to end of insertion order)
    const reordered = {
      lockfileVersion: 1 as const,
      facets: { a: entry('0.1.0'), c: entry('0.3.0'), b: entry('0.2.0') },
    }
    writeLockfile(projectRoot, reordered)
    const bytesReordered = readFileSync(join(projectRoot, FACETS_LOCK_FILE), 'utf8')

    expect(bytesReordered).toBe(bytesOriginal)
  })

  test('sorted output round-trips through loadLockfile', () => {
    const lockfile = {
      lockfileVersion: 1 as const,
      facets: { zeta: entry('0.3.0'), alpha: entry('0.1.0') },
    }
    writeLockfile(projectRoot, lockfile)
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.data.facets.alpha).toEqual(lockfile.facets.alpha)
    expect(result.data.facets.zeta).toEqual(lockfile.facets.zeta)
  })
})
