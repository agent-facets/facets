import type { SupportedLockfileFacet } from '@agent-facets/protocol'
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
  previous: SupportedLockfileFacet | undefined,
  currentVersion: string,
  assetsWritten: number,
): FacetOutcome {
  if (previous === undefined) {
    return { kind: 'installed', name, version: currentVersion }
  }
  if (previous.version !== currentVersion) {
    return {
      kind: 'updated',
      name,
      oldVersion: previous.version,
      newVersion: currentVersion,
    }
  }
  if (assetsWritten > 0) {
    return { kind: 'repaired', name, version: currentVersion }
  }
  return { kind: 'unchanged', name, version: currentVersion }
}
