import type { SupportedLockfile, SupportedLockfileFacet } from '@agent-facets/protocol'
import { satisfies } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../manifest/mutations.ts'
import { ownEntry } from './own-entry.ts'
import { parseLockedVersion } from './parse-locked-version.ts'
import { parseManifestFacetSource } from './parse-manifest-source.ts'
import { sourceMatchesLockedSource } from './source-matches.ts'
import type { LockfileDriftEntry } from './types.ts'

/**
 * Coverage check: collect every manifest facet whose lockfile coverage is
 * missing or stale. Returns an empty array when the lockfile fully and
 * consistently covers the manifest. Every entry must name the source it was
 * locked from, and a registry specifier must also be satisfied by the locked
 * version.
 *
 * Two callers ask the same question for different reasons: the frozen
 * pre-flight, which must fail when the lockfile no longer reproduces the
 * manifest, and the removal-only refinement, which may skip resolution only
 * while every remaining facet is still answered by its locked entry.
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
    const parsed = parseManifestFacetSource(name, specifier)
    if (!parsed.ok) continue
    // Source first, for every kind. The locked source is the contract, and a
    // manifest that points elsewhere — another URL, another path, or another
    // KIND of source — would build from an origin the lockfile never pinned.
    // A kind change matters most: resolution drops the stale anchor, so the
    // new content is never reconciled against what was locked. Canonical,
    // post-parse values are compared, never the raw specifier text, so a
    // shorthand (`github:owner/repo`, a `#ref` suffix, a `file:` prefix)
    // still matches the provenance a fresh install wrote.
    if (!sourceMatchesLockedSource(parsed.value, locked.source)) {
      drift.push({ name, reason: 'source-changed', manifestSpec: specifier, lockedSource: describeSource(locked) })
      continue
    }
    // Same registry: the locked version must still satisfy the specifier.
    if (parsed.value.kind === 'registry' && !satisfies(parseLockedVersion(locked.version), parsed.value.version)) {
      drift.push({ name, reason: 'unsatisfied', manifestSpec: specifier, lockedVersion: locked.version })
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

/** The locked origin as a user would recognize it. */
function describeSource(locked: SupportedLockfileFacet): string {
  switch (locked.source.kind) {
    case 'registry':
      return locked.source.registry
    case 'git':
      return locked.source.url
    case 'local':
      return locked.source.path
  }
}
