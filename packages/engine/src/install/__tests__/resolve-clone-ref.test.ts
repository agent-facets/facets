import { describe, expect, test } from 'bun:test'
import type { LockfileFacet } from '@agent-facets/protocol'
import { resolveCloneRef } from '../run-install.ts'

const lockedWithCommit: LockfileFacet = {
  source: 'github:agent-facets/viper-plans#main',
  ref: 'main',
  commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  version: '0.1.0',
  integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  assets: [],
}

const lockedWithoutCommit: LockfileFacet = {
  source: 'github:agent-facets/viper-plans#main',
  version: '0.1.0',
  integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  assets: [],
}

describe('resolveCloneRef', () => {
  test('locked commit wins over manifest ref (reproducibility guarantee)', () => {
    expect(resolveCloneRef(lockedWithCommit, 'main')).toBe(lockedWithCommit.commit)
  })

  test('locked commit wins even when manifest ref is undefined', () => {
    expect(resolveCloneRef(lockedWithCommit, undefined)).toBe(lockedWithCommit.commit)
  })

  test('falls back to manifest ref when locked entry exists but has no commit', () => {
    expect(resolveCloneRef(lockedWithoutCommit, 'main')).toBe('main')
  })

  test('falls back to manifest ref when no locked entry (fresh add)', () => {
    expect(resolveCloneRef(undefined, 'main')).toBe('main')
  })

  test('returns undefined when neither locked commit nor manifest ref is set', () => {
    expect(resolveCloneRef(undefined, undefined)).toBeUndefined()
    expect(resolveCloneRef(lockedWithoutCommit, undefined)).toBeUndefined()
  })
})
