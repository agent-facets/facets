import type { LockfileFacet, ResolvedFacetManifest } from '@agent-facets/protocol'
import type { RunInstallFailure } from '../types.ts'

/**
 * What a per-source-kind resolver hands back to the commit
 * orchestrator: the lockfile entry to record, the resolved manifest
 * (prompt bodies loaded) for materialization, and any server
 * declarations to warn about.
 */
export interface ResolvedFacet {
  entry: LockfileFacet
  resolved: ResolvedFacetManifest
  serversDeclared: ReadonlyArray<string>
}

/**
 * Result of resolving a single facet through its source-kind resolver
 * (`resolveRegistryFacet` / `resolveGitFacet` / `resolveLocalFacet`).
 * Discriminated by `ok`; failures are the orchestrator-level
 * `RunInstallFailure` so the commit loop forwards them unchanged.
 */
export type ResolveFacetResult = { ok: true; value: ResolvedFacet } | { ok: false; failure: RunInstallFailure }
