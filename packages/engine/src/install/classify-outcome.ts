import {
  type CurrentLockfileFacet,
  lockedDispositionOf,
  type SupportedLockfileFacet,
  sameDisposition,
} from '@agent-facets/protocol'
import type { McpInstallOutcomes } from './mcp/outcomes.ts'
import type { FacetOutcome } from './types.ts'

function identityKey(asset: { scope: string; type: string; name: string }): string {
  return `${asset.scope}\u0000${asset.type}\u0000${asset.name}`
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
  const before = new Map(previous.assets.map((asset) => [identityKey(asset), lockedDispositionOf(asset)]))
  for (const asset of current.assets) {
    const prior = before.get(identityKey(asset))
    if (prior === undefined) continue
    if (!sameDisposition(prior, asset.materialization)) return true
  }
  return false
}

/**
 * What reconciling one facet's MCP declarations amounted to.
 *
 * Two independent booleans rather than one status, because they answer
 * different questions and can both be true: the project can change what it
 * asks for at the same moment a tool's config file turns out to have drifted.
 * Neither can be derived from the lockfile — servers are deliberately absent
 * from it — so both arrive from the MCP outcomes.
 */
export interface FacetConfigurationWork {
  /**
   * The project's intent changed: a different declaration, a new or removed
   * alias, or an omission that was not there before.
   */
  intentChanged: boolean
  /** Reconciling this facet's declarations had to write native configuration. */
  reconciled: boolean
}

/** A facet with no server declarations at all, which is most of them. */
export const NO_CONFIGURATION_WORK: FacetConfigurationWork = { intentChanged: false, reconciled: false }

/**
 * Attribute this run's MCP work back to the facets that asked for it.
 *
 * An effective configuration can be claimed by several facets at once — that
 * is what identical declarations compose INTO — so reconciling it is work on
 * behalf of every one of them. Splitting the credit would mean picking a
 * winner among claimants that are, by construction, indistinguishable.
 *
 * `introduced` deliberately does not count as an intent change: a declaration
 * this machine has no record of is either a brand-new facet (already
 * `installed`) or one whose configuration never landed, and the second is a
 * repair rather than a change of mind. `unwitnessed` claims nothing at all.
 */
export function facetConfigurationWork(mcp: McpInstallOutcomes): Map<string, FacetConfigurationWork> {
  const work = new Map<string, FacetConfigurationWork>()
  const mark = (facet: string, change: Partial<FacetConfigurationWork>): void => {
    const existing = work.get(facet) ?? NO_CONFIGURATION_WORK
    work.set(facet, { ...existing, ...change })
  }

  for (const disposition of mcp.dispositions) {
    if (disposition.change === 'updated') mark(disposition.facet, { intentChanged: true })
  }
  // A pruned override is intent that changed too: the project stopped saying
  // something about a declaration, and the facet's entry in `facets.json` is
  // materially different afterwards.
  for (const pruned of mcp.prunedIntent) {
    mark(pruned.facet, { intentChanged: true })
  }
  for (const configuration of mcp.configurations) {
    if (configuration.kind !== 'active' || configuration.status === 'unchanged') continue
    for (const facet of configuration.claimants) mark(facet, { reconciled: true })
  }
  return work
}

/**
 * Classify a per-facet outcome by comparing the previous lockfile entry (if
 * any) against what this run resolved, composed, and reconciled.
 *
 *   - `installed` — the facet was not in the previous lockfile.
 *   - `updated`   — a different version, OR the same version with different
 *     materialization intent. Aliasing or omitting an asset or a server
 *     changes what is on disk and what the project records, so reporting it
 *     as `unchanged` would describe a real change as a no-op. It is not
 *     `repaired` either: nothing drifted, the project asked for something
 *     different.
 *   - `repaired`  — same version and same intent, but an asset or a native
 *     MCP entry had to be rewritten because the state on disk had drifted.
 *   - `unchanged` — same version, same intent, nothing written.
 *
 * A facet that publishes only servers reaches the same four answers on the
 * strength of `configuration` alone, which is what keeps it from reporting
 * itself as a no-op every time.
 */
export function classifyOutcome(
  name: string,
  previous: SupportedLockfileFacet | undefined,
  current: CurrentLockfileFacet,
  assetsWritten: number,
  configuration: FacetConfigurationWork = NO_CONFIGURATION_WORK,
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
  if (dispositionsChanged(previous, current) || configuration.intentChanged) {
    return {
      kind: 'updated',
      name,
      oldVersion: previous.version,
      newVersion: current.version,
    }
  }
  if (assetsWritten > 0 || configuration.reconciled) {
    return { kind: 'repaired', name, version: current.version }
  }
  return { kind: 'unchanged', name, version: current.version }
}
