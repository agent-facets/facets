import type { FacetsJson, Lockfile } from '@agent-facets/protocol'
import { satisfies } from '@agent-facets/protocol'
import { parseFacetSource } from '../sources/facet/parse-source.ts'
import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { parseLockedVersion } from './parse-locked-version.ts'
import type { LockfileDriftEntry } from './types.ts'

/**
 * Frozen-lockfile pre-flight: collect every manifest facet whose lockfile
 * coverage is missing or stale. Returns an empty array when the lockfile
 * fully and consistently covers the manifest. Registry specifiers must be
 * satisfied by the locked version; git/local entries need only exist.
 */
export function detectLockfileDrift(
  facetsJson: FacetsJson,
  previousLockfile: Lockfile,
  lockfileExisted: boolean,
): LockfileDriftEntry[] {
  const drift: LockfileDriftEntry[] = []
  for (const [name, specifier] of Object.entries(facetsJson.facets)) {
    if (!lockfileExisted) {
      drift.push({ name, reason: 'missing-lockfile', manifestSpec: specifier })
      continue
    }
    const locked = previousLockfile.facets[name]
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
      if (facetsJson.facets[name] === undefined) {
        drift.push({ name, reason: 'orphaned', lockedVersion: locked.version })
      }
    }
  }

  return drift
}
