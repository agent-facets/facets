import { describe, expect, test } from 'bun:test'
import type {
  CurrentLockfileFacet,
  Lockfile02Facet,
  MaterializationDisposition,
  SupportedLockfileFacet,
} from '@agent-facets/protocol'
import { classifyOutcome } from '../classify-outcome.ts'

const HASH = `sha256:${'0'.repeat(64)}`
const SOURCE = { kind: 'registry', registry: 'https://api.agentfacets.io' } as const

/** A current entry whose single skill carries the given disposition. */
const entry = (
  version: string,
  materialization: MaterializationDisposition = { kind: 'authored' },
): CurrentLockfileFacet => ({
  source: SOURCE,
  version,
  integrity: 'sha256:stub',
  assets: [
    {
      scope: 'user',
      type: 'skill',
      name: 'planning',
      materialization,
      files: [{ path: 'skills/planning/SKILL.md', integrity: HASH }],
    },
  ],
})

/** A `0.2` entry: per-file records, but no disposition field. */
const entry02 = (version: string): Lockfile02Facet => ({
  source: SOURCE,
  version,
  integrity: 'sha256:stub',
  assets: [
    {
      scope: 'user',
      type: 'skill',
      name: 'planning',
      files: [{ path: 'skills/planning/SKILL.md', integrity: HASH }],
    },
  ],
})

describe('classifyOutcome', () => {
  test('no previous entry → installed', () => {
    expect(classifyOutcome('cowsay', undefined, entry('1.0.0'), 1)).toEqual({
      kind: 'installed',
      name: 'cowsay',
      version: '1.0.0',
    })
  })

  test('version changed → updated with old/new versions', () => {
    expect(classifyOutcome('cowsay', entry('1.0.0'), entry('1.1.0'), 1)).toEqual({
      kind: 'updated',
      name: 'cowsay',
      oldVersion: '1.0.0',
      newVersion: '1.1.0',
    })
  })

  test('same version, assets written → repaired', () => {
    expect(classifyOutcome('cowsay', entry('1.0.0'), entry('1.0.0'), 2)).toEqual({
      kind: 'repaired',
      name: 'cowsay',
      version: '1.0.0',
    })
  })

  test('same version, nothing written → unchanged', () => {
    expect(classifyOutcome('cowsay', entry('1.0.0'), entry('1.0.0'), 0)).toEqual({
      kind: 'unchanged',
      name: 'cowsay',
      version: '1.0.0',
    })
  })

  test('version change takes precedence over assetsWritten count', () => {
    // Even with 0 assets written, a version difference is an update.
    expect(classifyOutcome('cowsay', entry('1.0.0'), entry('2.0.0'), 0).kind).toBe('updated')
  })

  describe('disposition-only changes at an unchanged version', () => {
    test('adding an alias is updated, not unchanged', () => {
      const previous = entry('1.0.0')
      const current = entry('1.0.0', { kind: 'aliased', as: 'vendor-planning' })
      // Reporting this as `unchanged` would describe a rename of what lands
      // on disk as a no-op.
      expect(classifyOutcome('cowsay', previous, current, 0)).toEqual({
        kind: 'updated',
        name: 'cowsay',
        oldVersion: '1.0.0',
        newVersion: '1.0.0',
      })
    })

    test('changing an alias target is updated', () => {
      const previous = entry('1.0.0', { kind: 'aliased', as: 'one' })
      const current = entry('1.0.0', { kind: 'aliased', as: 'two' })
      expect(classifyOutcome('cowsay', previous, current, 0).kind).toBe('updated')
    })

    test('omitting an asset is updated', () => {
      const previous = entry('1.0.0')
      const current = entry('1.0.0', { kind: 'omitted' })
      expect(classifyOutcome('cowsay', previous, current, 0).kind).toBe('updated')
    })

    test('restoring authored materialization is updated', () => {
      const previous = entry('1.0.0', { kind: 'omitted' })
      const current = entry('1.0.0')
      expect(classifyOutcome('cowsay', previous, current, 0).kind).toBe('updated')
    })

    test('an unchanged alias at an unchanged version is not an update', () => {
      const alias: MaterializationDisposition = { kind: 'aliased', as: 'vendor-planning' }
      expect(classifyOutcome('cowsay', entry('1.0.0', alias), entry('1.0.0', alias), 0).kind).toBe('unchanged')
    })

    test('disposition change outranks disk drift', () => {
      // Both changed; the intent change is the more informative report.
      const previous = entry('1.0.0')
      const current = entry('1.0.0', { kind: 'aliased', as: 'vendor-planning' })
      expect(classifyOutcome('cowsay', previous, current, 3).kind).toBe('updated')
    })
  })

  describe('entries predating dispositions', () => {
    // `0.2` is now the only readable shape that lacks `materialization`, so
    // it is the shape the refinement has to narrow in a real upgrade.
    test('a 0.2 entry compares equal to explicit authored materialization', () => {
      // A version that could not record a disposition meant authored. Treating
      // it as "unknown" would report every first install after the upgrade as
      // an update.
      const previous: SupportedLockfileFacet = entry02('1.0.0')
      expect(classifyOutcome('cowsay', previous, entry('1.0.0'), 0).kind).toBe('unchanged')
    })

    test('a 0.2 entry against a new alias is still an update', () => {
      const previous: SupportedLockfileFacet = entry02('1.0.0')
      const current = entry('1.0.0', { kind: 'aliased', as: 'vendor-planning' })
      expect(classifyOutcome('cowsay', previous, current, 0).kind).toBe('updated')
    })

    test('a 0.2 entry against a new omission is an update', () => {
      const previous: SupportedLockfileFacet = entry02('1.0.0')
      expect(classifyOutcome('cowsay', previous, entry('1.0.0', { kind: 'omitted' }), 0).kind).toBe('updated')
    })
  })
})
