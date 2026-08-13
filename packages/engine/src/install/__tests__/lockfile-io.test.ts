import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENT_LOCKFILE_VERSION, compareCodeUnits, LOCKFILE_VERSION_0_2 } from '@agent-facets/protocol'
import { FACETS_LOCK_FILE, loadLockfile, writeLockfile } from '../lockfile-io.ts'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'facet-lockfile-io-test-'))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('loadLockfile — empty/missing', () => {
  test('missing file returns an empty lockfile at the current version with existed=false', () => {
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) expect.unreachable()
    expect(result.existed).toBe(false)
    expect(result.parsed.lockfile.facets).toEqual({})
    expect(result.parsed.lockfile.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
    expect(result.parsed.lockfileVersion).toBe(CURRENT_LOCKFILE_VERSION)
  })

  test('missing file carries the absent state', () => {
    const result = loadLockfile(projectRoot)
    if (!result.ok) expect.unreachable()
    if (result.existed) expect.unreachable()
    expect(result.state).toEqual({ kind: 'absent' })
  })
})

// The state a load reports is the commit's write precondition, so it has to
// describe the bytes that were parsed.
describe('loadLockfile — the state it was parsed from', () => {
  test('carries the exact bytes it parsed', () => {
    const text = `${JSON.stringify({ lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} }, null, 2)}\n`
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), text)

    const result = loadLockfile(projectRoot)
    if (!result.ok) expect.unreachable()
    if (!result.existed) expect.unreachable()
    expect(new TextDecoder().decode(result.state.contents)).toBe(text)
  })

  test('reports a path occupied by something other than a plain file', () => {
    mkdirSync(join(projectRoot, FACETS_LOCK_FILE))

    const result = loadLockfile(projectRoot)
    if (result.ok) expect.unreachable()
    expect(result.error).toContain('directory')
  })
})

describe('loadLockfile — round-trip', () => {
  test('writes and reads back an identical current-version lockfile', () => {
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

  test('loads a 0.2 lockfile under the 0.2 schema', () => {
    const previous = {
      lockfileVersion: LOCKFILE_VERSION_0_2 as typeof LOCKFILE_VERSION_0_2,
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
              files: [{ path: 'skills/planning/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
            },
          ],
        },
      },
    }
    // Seeded as raw bytes, not through `writeLockfile`: the writer only
    // emits the current schema by design, so an earlier document can only
    // arrive from disk. That is exactly the case under test.
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify(previous, null, 2))
    const loaded = loadLockfile(projectRoot)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) expect.unreachable()
    expect(loaded.parsed.lockfile).toEqual(previous)
    expect(loaded.parsed.lockfileVersion).toBe(LOCKFILE_VERSION_0_2)
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
      JSON.stringify({ lockfileVersion: LOCKFILE_VERSION_0_2, facets: { x: { source: 'x' } } }),
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

  // A known-withdrawn version and an unrecognized one need OPPOSITE remedies:
  // regenerating a withdrawn format is safe, while deleting a file written by
  // a schema this CLI simply does not know would discard a teammate's
  // resolutions. The two are told apart by recognizing the withdrawn value
  // exactly — note that `1` is numerically the largest number in play here,
  // so magnitude could not make this call.
  test('the withdrawn alpha version 1 fails with delete-and-regenerate guidance', () => {
    writeFileSync(join(projectRoot, FACETS_LOCK_FILE), JSON.stringify({ lockfileVersion: 1, facets: {} }))
    const result = loadLockfile(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable()
    expect(result.error).toContain('unsupported lockfileVersion')
    expect(result.error).toContain('no longer read')
    expect(result.error).toContain(`Delete ${FACETS_LOCK_FILE}`)
    expect(result.error).not.toContain('Upgrade the CLI')
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

  test('a malformed 0.2 lockfile is not reinterpreted under another version', () => {
    // `files` is required on 0.2 asset entries; omitting it is a 0.2 schema
    // violation, never a fallback to some other shape.
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

  // Scoped names are where locale collation and code-unit ordering part
  // company: `@` and `/` carry variable weight in default ICU collation, so
  // `localeCompare` could put these in a different order than the planner
  // does — and in a different order on a machine with different ICU data.
  // The whole point of sorting on write is that it does not depend on where
  // the write happened.
  test('orders scoped names by code unit, matching the planner', () => {
    const names = ['@zeta/a', 'alpha', '@alpha/b', 'Zeta']
    const facets = Object.fromEntries(names.map((name) => [name, entry('0.1.0')]))
    writeLockfile(projectRoot, {
      lockfileVersion: CURRENT_LOCKFILE_VERSION as typeof CURRENT_LOCKFILE_VERSION,
      facets,
    })

    const keys = Object.keys(JSON.parse(readFileSync(join(projectRoot, FACETS_LOCK_FILE), 'utf8')).facets)
    expect(keys).toEqual([...names].sort(compareCodeUnits))
    // Pinned literally too, so the assertion above cannot be satisfied by
    // both sides sharing the same wrong comparator.
    expect(keys).toEqual(['@alpha/b', '@zeta/a', 'Zeta', 'alpha'])
  })

  // A facet key is an arbitrary string from a file on disk. Assignment for
  // this one creates no own member, so the canonical re-materialization was
  // the last place a locked facet could vanish on its way to disk.
  test('a facet named __proto__ round-trips', () => {
    const raw = JSON.stringify({
      lockfileVersion: CURRENT_LOCKFILE_VERSION,
      facets: { PLACEHOLDER: entry('0.1.0'), b: entry('0.2.0') },
    }).replace('"PLACEHOLDER"', '"__proto__"')
    const lockfile = JSON.parse(raw)

    writeLockfile(projectRoot, lockfile)

    const written = JSON.parse(readFileSync(join(projectRoot, FACETS_LOCK_FILE), 'utf8'))
    expect(Object.hasOwn(written.facets, '__proto__')).toBe(true)
    expect(Object.keys(written.facets)).toEqual(['__proto__', 'b'])
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
