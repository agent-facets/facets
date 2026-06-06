import { describe, expect, test } from 'bun:test'
import type { LockfileFacet } from '@agent-facets/protocol'
import { parseFacetSource } from '../../sources/facet/parse-source.ts'
import { resolveEffectiveLockedForPlan } from '../plan-facet.ts'
import { resolveCloneRef } from '../resolve-clone-ref.ts'

const lockedGitEntry: LockfileFacet = {
  source: 'https://github.com/example/old.git#stable',
  ref: 'stable',
  commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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

    const effectiveLocked = resolveEffectiveLockedForPlan(lockedGitEntry, source, manifestSpecifier)

    expect(effectiveLocked).toBeUndefined()
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe('main')
  })

  test('keeps the locked commit when the git source is unchanged', () => {
    const source = parseGitSource(lockedGitEntry.source)

    const effectiveLocked = resolveEffectiveLockedForPlan(lockedGitEntry, source, lockedGitEntry.source)

    expect(effectiveLocked).toBe(lockedGitEntry)
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe(lockedGitEntry.commit)
  })
})
