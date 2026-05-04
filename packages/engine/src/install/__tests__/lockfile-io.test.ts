import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
          source: 'github:agent-facets/viper-plans#main',
          ref: 'main',
          commit: 'abc123',
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
