import { describe, expect, test } from 'bun:test'
import type { Lockfile02Facet } from '@agent-facets/protocol'
import { parseFacetSource } from '../../../sources/facet/parse-source.ts'
import { resolveCloneRef } from '../../resolve-clone-ref.ts'
import { resolveEffectiveLocked } from '../effective-locked.ts'

const LOCKED_GIT_URL = 'https://github.com/example/old.git#stable'
const LOCKED_GIT_COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const lockedGitEntry: Lockfile02Facet = {
  source: { kind: 'git', url: LOCKED_GIT_URL, commit: LOCKED_GIT_COMMIT },
  version: '0.1.0',
  integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  assets: [
    {
      scope: 'project',
      type: 'skill',
      name: 'planning',
      files: [{ path: 'skills/planning/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
    },
  ],
}

const lockedRegistryEntry: Lockfile02Facet = {
  source: { kind: 'registry', registry: 'https://api.agentfacets.io' },
  version: '0.4.0',
  integrity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  assets: [
    {
      scope: 'project',
      type: 'skill',
      name: 'planning',
      files: [{ path: 'skills/planning/SKILL.md', integrity: `sha256:${'0'.repeat(64)}` }],
    },
  ],
}

function parseSource(specifier: string) {
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok) expect.unreachable()
  return parsed.value
}

function parseGitSource(specifier: string) {
  const source = parseSource(specifier)
  if (source.kind !== 'git') expect.unreachable()
  return source
}

describe('resolveEffectiveLocked — changed git source', () => {
  test('does not let the old commit constrain a new git source', () => {
    const source = parseGitSource('https://github.com/example/new.git#main')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedGitEntry, source, isExplicitAddition: false })

    expect(effectiveLocked).toBeUndefined()
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe('main')
  })

  test('keeps the locked commit when the git source is unchanged', () => {
    const source = parseGitSource(LOCKED_GIT_URL)

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedGitEntry, source, isExplicitAddition: false })

    expect(effectiveLocked).toBe(lockedGitEntry)
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe(LOCKED_GIT_COMMIT)
  })

  test('keeps the locked commit when GitHub shorthand canonicalizes to the locked URL', () => {
    // Manifest uses `github:` shorthand; the lock stores the canonical
    // `https://...git` URL a fresh install wrote. These must be treated as
    // the same source — not stale — so the locked commit is reused.
    const lockedEntry: Lockfile02Facet = {
      ...lockedGitEntry,
      source: { kind: 'git', url: 'https://github.com/agent-facets/planner.git', commit: LOCKED_GIT_COMMIT },
    }
    const source = parseGitSource('github:agent-facets/planner')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedEntry, source, isExplicitAddition: false })

    expect(effectiveLocked).toBe(lockedEntry)
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe(LOCKED_GIT_COMMIT)
  })

  test('keeps the locked commit when only the manifest ref differs from the locked URL', () => {
    // The lock stores a URL with an embedded `#stable` ref (older-style /
    // hand-written); the manifest requests the same repo at `#main`. A ref
    // is a manifest concern, not lockfile provenance, so the canonical URLs
    // match and the entry is NOT stale.
    const source = parseGitSource('https://github.com/example/old.git#main')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedGitEntry, source, isExplicitAddition: false })

    expect(effectiveLocked).toBe(lockedGitEntry)
    expect(resolveCloneRef(effectiveLocked, source.ref)).toBe(LOCKED_GIT_COMMIT)
  })
})

describe('resolveEffectiveLocked — registry staleness', () => {
  test('keeps a satisfying entry for a plain install (not an addition)', () => {
    const source = parseSource('cowsay@0.*')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedRegistryEntry, source, isExplicitAddition: false })

    expect(effectiveLocked).toBe(lockedRegistryEntry)
  })

  test('clears a stale entry whose version no longer satisfies the spec', () => {
    const source = parseSource('cowsay@1.*')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedRegistryEntry, source, isExplicitAddition: false })

    expect(effectiveLocked).toBeUndefined()
  })
})

describe('resolveEffectiveLocked — the structural discriminator', () => {
  test('a non-exact explicit addition never trusts the lockfile, even when satisfied', () => {
    // `add cowsay@0.*` with a lock satisfying `0.*` — the user asked for a
    // re-resolve; the locked version must not pin resolution.
    const source = parseSource('cowsay@0.*')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedRegistryEntry, source, isExplicitAddition: true })

    expect(effectiveLocked).toBeUndefined()
  })

  test('a bare/latest explicit addition never trusts the lockfile', () => {
    const source = parseSource('cowsay@latest')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedRegistryEntry, source, isExplicitAddition: true })

    expect(effectiveLocked).toBeUndefined()
  })

  test('an EXACT explicit addition still benefits from a satisfying entry', () => {
    // Exact re-add of an already-locked version: no version resolution is
    // needed, and the locked integrity remains the trust anchor — the
    // commit can be served offline from a warm cache.
    const source = parseSource('cowsay@0.4.0')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedRegistryEntry, source, isExplicitAddition: true })

    expect(effectiveLocked).toBe(lockedRegistryEntry)
  })

  test('an exact explicit addition of a DIFFERENT version clears the entry', () => {
    const source = parseSource('cowsay@0.5.0')

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedRegistryEntry, source, isExplicitAddition: true })

    expect(effectiveLocked).toBeUndefined()
  })

  test('a git addition is unaffected by the discriminator (no registry version to resolve)', () => {
    const source = parseGitSource(LOCKED_GIT_URL)

    const effectiveLocked = resolveEffectiveLocked({ locked: lockedGitEntry, source, isExplicitAddition: true })

    expect(effectiveLocked).toBe(lockedGitEntry)
  })
})
