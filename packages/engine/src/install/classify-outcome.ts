import type { CurrentLockfileFacet, MaterializationDisposition, SupportedLockfileFacet } from '@agent-facets/protocol'
import type { FacetOutcome } from './types.ts'

function identityKey(asset: { scope: string; type: string; name: string }): string {
  return `${asset.scope}\u0000${asset.type}\u0000${asset.name}`
}

/**
 * The disposition a locked asset records. Versions predating dispositions
 * meant authored materialization — the only thing they could have meant —
 * so they compare equal to an explicit `authored` rather than to "unknown".
 */
function dispositionOf(asset: SupportedLockfileFacet['assets'][number]): MaterializationDisposition {
  return 'materialization' in asset ? asset.materialization : { kind: 'authored' }
}

function sameDisposition(a: MaterializationDisposition, b: MaterializationDisposition): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'aliased' && b.kind === 'aliased' ? a.as === b.as : true
}

/**
 * Whether the project's materialization intent for this facet changed.
 *
 * Compares per authored asset identity. A changed asset SET is not a
 * disposition change — that is a content change, already visible as a
 * version bump or caught by reconciliation — so only identities present in
 * both entries are compared.
 */
function dispositionsChanged(previous: SupportedLockfileFacet, current: CurrentLockfileFacet): boolean {
  const before = new Map(previous.assets.map((asset) => [identityKey(asset), dispositionOf(asset)]))
  for (const asset of current.assets) {
    const prior = before.get(identityKey(asset))
    if (prior === undefined) continue
    if (!sameDisposition(prior, asset.materialization)) return true
  }
  return false
}

/**
 * Classify a per-facet outcome by comparing the previous lockfile entry (if
 * any) against what this run resolved and composed.
 *
 *   - `installed` — the facet was not in the previous lockfile.
 *   - `updated`   — a different version, OR the same version with different
 *     materialization intent. Aliasing or omitting an asset changes what is
 *     on disk and what the lockfile records, so reporting it as `unchanged`
 *     would describe a real change as a no-op. It is not `repaired` either:
 *     nothing drifted, the project asked for something different.
 *   - `repaired`  — same version and same intent, but at least one asset had
 *     to be rewritten because on-disk state had drifted.
 *   - `unchanged` — same version, same intent, nothing written.
 */
export function classifyOutcome(
  name: string,
  previous: SupportedLockfileFacet | undefined,
  current: CurrentLockfileFacet,
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
  if (dispositionsChanged(previous, current)) {
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
