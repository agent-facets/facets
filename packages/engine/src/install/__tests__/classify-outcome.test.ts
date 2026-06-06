import { describe, expect, test } from 'bun:test'
import type { LockfileFacet } from '@agent-facets/protocol'
import { classifyOutcome } from '../classify-outcome.ts'

const entry = (version: string): LockfileFacet => ({
  source: version,
  version,
  integrity: 'sha256:stub',
  assets: [{ scope: 'user', type: 'skill', name: 'planning' }],
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
})
