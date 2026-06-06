import { describe, expect, test } from 'bun:test'
import type { LockfileFacet } from '@agent-facets/protocol'
import { parseFacetSource } from '../../sources/facet/parse-source.ts'
import { resolveEffectiveLockedForPlan } from '../plan-facet.ts'
import { resolveCloneRef } from '../resolve-clone-ref.ts'

const LOCKED_GIT_URL = 'https://github.com/example/old.git#stable'
const LOCKED_GIT_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const lockedGitEntry: LockfileFacet = {
  source: { kind: 'git', url: LOCKED_GIT_URL, commit: LOCKED_GIT_COMMIT },
  version: '0.1.0',
  integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  assets: [{ scope: 'project', type: 'skill', name: 'planning' }],
}

function parseGitSource(specifier: string) {
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok) expect.unreachable()
  if (parsed.value.kind !== 'git') expect.unreachable()
  return parsed.value
}

describe('planFacet — changed git source', () => {
  test('does not let the old commit constrain a new git source', () => {
    const manifestSpecifier = 'https://github.com/example/new.git#main'
    const source = parseGitSource(manifestSpecifier)

    const effectiveLocked = resolveEffectiveLockedForPlan(lockedGitEntry, source)

    expect(effectiveLocked).toBeUndefined()
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe('main')
  })

  test('keeps the locked commit when the git source is unchanged', () => {
    const source = parseGitSource(LOCKED_GIT_URL)

    const effectiveLocked = resolveEffectiveLockedForPlan(lockedGitEntry, source)

    expect(effectiveLocked).toBe(lockedGitEntry)
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe(LOCKED_GIT_COMMIT)
  })

  test('keeps the locked commit when GitHub shorthand canonicalizes to the locked URL', () => {
    // Manifest uses `github:` shorthand; the lock stores the canonical
    // `https://...git` URL a fresh install wrote. These must be treated as
    // the same source — not stale — so the locked commit is reused.
    const lockedEntry: LockfileFacet = {
      ...lockedGitEntry,
      source: { kind: 'git', url: 'https://github.com/agent-facets/planner.git', commit: LOCKED_GIT_COMMIT },
    }
    const source = parseGitSource('github:agent-facets/planner')

    const effectiveLocked = resolveEffectiveLockedForPlan(lockedEntry, source)

    expect(effectiveLocked).toBe(lockedEntry)
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe(LOCKED_GIT_COMMIT)
  })

  test('keeps the locked commit when only the manifest ref differs from the locked URL', () => {
    // The lock stores a URL with an embedded `#stable` ref (older-style /
    // hand-written); the manifest requests the same repo at `#main`. A ref
    // is a manifest concern, not lockfile provenance, so the canonical URLs
    // match and the entry is NOT stale.
    const source = parseGitSource('https://github.com/example/old.git#main')

    const effectiveLocked = resolveEffectiveLockedForPlan(lockedGitEntry, source)

    expect(effectiveLocked).toBe(lockedGitEntry)
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe(LOCKED_GIT_COMMIT)
  })
})
