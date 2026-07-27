import type { AssetType } from '@agent-facets/common'

/**
 * Materialization namespaces — the logical name spaces asset types compete
 * in (design D9).
 *
 * Two assets may share a name freely across namespaces but never within
 * one. Skills and commands share a namespace because they materialize into
 * a single flat command surface in the tools facets target; agents occupy
 * their own.
 *
 * Namespaces are named after their members rather than numbered so a
 * namespace is self-describing in structured failure data.
 */
export type MaterializationNamespace = 'skill-command' | 'agent'

/**
 * The asset-type → namespace mapping. This is the single published source
 * of truth for the D9 rule; every layer that enforces it — facet-manifest
 * validation, archive verification, and cross-facet materialization
 * planning — derives from this map rather than restating the pairing.
 *
 * The `Record<AssetType, …>` annotation is load-bearing: adding a member to
 * `AssetType` fails to compile until its namespace is declared here. That
 * closes the failure mode the previous hand-written check had, where the
 * agent exemption was encoded by *absence* from a two-field condition and a
 * fourth asset type would have silently skipped validation entirely.
 */
export const MATERIALIZATION_NAMESPACE: Readonly<Record<AssetType, MaterializationNamespace>> = {
  skill: 'skill-command',
  command: 'skill-command',
  agent: 'agent',
}

/** The materialization namespace an asset type competes for names in. */
export function materializationNamespace(type: AssetType): MaterializationNamespace {
  return MATERIALIZATION_NAMESPACE[type]
}

/**
 * Whether two asset types compete for the same names. Reflexive: a type
 * always shares a namespace with itself.
 */
export function sharesNamespace(a: AssetType, b: AssetType): boolean {
  return MATERIALIZATION_NAMESPACE[a] === MATERIALIZATION_NAMESPACE[b]
}
