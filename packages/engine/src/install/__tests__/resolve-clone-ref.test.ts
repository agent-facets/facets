import { describe, expect, test } from 'bun:test'
import type { LockfileFacet } from '@agent-facets/protocol'
import { resolveCloneRef } from '../resolve-clone-ref.ts'

const COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const lockedGit: LockfileFacet = {
  source: { kind: 'git', url: 'github:agent-facets/viper-plans#main', commit: COMMIT },
  version: '0.1.0',
  integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  assets: [],
}

// A locked non-git source (registry/local) carries no commit, so the
// helper falls back to the manifest ref — same path as a fresh add.
const lockedRegistry: LockfileFacet = {
  source: { kind: 'registry', registry: 'https://api.facet.cafe' },
  version: '0.1.0',
  integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  assets: [],
}

describe('resolveCloneRef', () => {
  test('locked git commit wins over manifest ref (reproducibility guarantee)', () => {
    expect(resolveCloneRef(lockedGit, 'main')).toBe(COMMIT)
  })

  test('locked git commit wins even when manifest ref is undefined', () => {
    expect(resolveCloneRef(lockedGit, undefined)).toBe(COMMIT)
  })

  test('falls back to manifest ref when the locked source is not git', () => {
    expect(resolveCloneRef(lockedRegistry, 'main')).toBe('main')
  })

  test('falls back to manifest ref when no locked entry (fresh add)', () => {
    expect(resolveCloneRef(undefined, 'main')).toBe('main')
  })

  test('returns undefined when neither a locked git commit nor manifest ref is set', () => {
    expect(resolveCloneRef(undefined, undefined)).toBeUndefined()
    expect(resolveCloneRef(lockedRegistry, undefined)).toBeUndefined()
  })
})
