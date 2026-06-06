import type { LockfileFacet } from '@agent-facets/protocol'
import type { FacetOutcome } from './types.ts'

/**
 * Classify a per-facet outcome by comparing the previous lockfile entry
 * (if any) against the new one. `assetsWritten` is the count of assets
 * `materialize` actually wrote (excluding skipped no-ops); when it's >0
 * but the lockfile entry is identical, the facet was "repaired" — the
 * on-disk state had drifted (file deleted, content edited) and we
 * restored it without bumping the version.
 */
export function classifyOutcome(
  name: string,
  previous: LockfileFacet | undefined,
  current: LockfileFacet,
  assetsWritten: number,
): FacetOutcome {
  if (previous === undefined) {
    return { kind: 'installed', name, version: current.version }
  }
  if (previous.version !== current.version) {
    return {
      kind: 'updated',
      name,
      oldVersion: previous.version,
      newVersion: current.version,
    }
  }
  if (assetsWritten > 0) {
    return { kind: 'repaired', name, version: current.version }
  }
  return { kind: 'unchanged', name, version: current.version }
}
