import type { SupportedLockfile } from '@agent-facets/protocol'
import { satisfies } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../manifest/mutations.ts'
import { parseFacetSource } from '../sources/facet/parse-source.ts'
import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { ownEntry } from './own-entry.ts'
import { parseLockedVersion } from './parse-locked-version.ts'
import { sourceMatchesLockedSource } from './source-matches.ts'
import type { LockfileDriftEntry } from './types.ts'

/**
 * Coverage check: collect every manifest facet whose lockfile coverage is
 * missing or stale. Returns an empty array when the lockfile fully and
 * consistently covers the manifest. Registry specifiers must be satisfied by
 * the locked version; git/local entries need only exist.
 *
 * Two callers ask the same question for different reasons: the frozen
 * pre-flight, which must fail when the lockfile no longer reproduces the
 * manifest, and the removal-only refinement, which may skip resolution only
 * while every survivor is still answered by its locked entry.
 */
export function detectLockfileDrift(
  facets: Readonly<Record<string, NormalizedFacetEntry>>,
  previousLockfile: SupportedLockfile,
  lockfileExisted: boolean,
): LockfileDriftEntry[] {
  const drift: LockfileDriftEntry[] = []
  for (const [name, entry] of Object.entries(facets)) {
    const specifier = entry.source
    if (!lockfileExisted) {
      drift.push({ name, reason: 'missing-lockfile', manifestSpec: specifier })
      continue
    }
    const locked = ownEntry(previousLockfile.facets, name)
    if (locked === undefined) {
      drift.push({ name, reason: 'no-entry', manifestSpec: specifier })
      continue
    }
    const sourceString = parseVersionSpec(specifier).ok ? `${name}@${specifier}` : specifier
    const parsed = parseFacetSource(sourceString)
    if (parsed.ok && parsed.value.kind === 'registry') {
      if (!satisfies(parseLockedVersion(locked.version), parsed.value.version)) {
        drift.push({ name, reason: 'unsatisfied', manifestSpec: specifier, lockedVersion: locked.version })
      }
    } else if (parsed.ok) {
      // git/local: any change to the parsed manifest source (a swapped URL
      // or local path) is drift in frozen mode. The locked source is the
      // contract; a differing source would otherwise build from an unlocked
      // origin. Compare canonical, post-parse values — never the raw
      // specifier text — so a manifest shorthand (`github:owner/repo`, a
      // `#ref` suffix, a `file:` prefix) matches the provenance a fresh
      // install wrote. Registry version drift is handled by the `satisfies`
      // check above, so this branch only fires for git and local sources —
      // and a registry locked source never reaches here.
      const lockedSourceString =
        locked.source.kind === 'git'
          ? locked.source.url
          : locked.source.kind === 'local'
            ? locked.source.path
            : undefined
      if (lockedSourceString !== undefined && !sourceMatchesLockedSource(parsed.value, locked.source)) {
        drift.push({ name, reason: 'source-changed', manifestSpec: specifier, lockedSource: lockedSourceString })
      }
    }
  }

  // Orphaned entries: pinned in the lockfile but no longer declared in the
  // manifest. In frozen mode these would otherwise be silently pruned by the
  // drift-removal loop (assets deleted) while the lockfile write is skipped —
  // mutating adapter state and leaving the orphan entry stale on disk. Surface
  // them as drift so the preflight fails before any mutation. Only meaningful
  // when a lockfile exists (a missing lockfile is already reported above).
  if (lockfileExisted) {
    for (const [name, locked] of Object.entries(previousLockfile.facets)) {
      if (ownEntry(facets, name) === undefined) {
        drift.push({ name, reason: 'orphaned', lockedVersion: locked.version })
      }
    }
  }

  return drift
}
