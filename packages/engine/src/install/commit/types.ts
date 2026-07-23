import type { LockfileFacet, ResolvedFacetManifest } from '@agent-facets/protocol'
import type { RunInstallFailure } from '../types.ts'
import type { SkillCompanionBytes, VerifiedAssetPlan } from '../verified-asset-plan.ts'

/**
 * What a per-source-kind resolver hands back to the commit
 * orchestrator: the lockfile entry to record, the resolved manifest
 * (prompt bodies loaded) for materialization, the verified asset plan
 * (per-file paths + recomputed hashes + ownership) that pre-materialization
 * reconciliation and materialization consume, the skill companion bytes read
 * from the verified directory (for atomic skill-bundle install), and any
 * server declarations to warn about.
 *
 * `plan` and `companionBytes` are `undefined` on the frozen-reproduction
 * path, where the entry is inherited verbatim (possibly legacy `1`) and no
 * fresh plan is derived. Reconciliation and companion materialization only
 * run when a plan is present.
 */
export interface ResolvedFacet {
  entry: LockfileFacet
  resolved: ResolvedFacetManifest
  plan: VerifiedAssetPlan | undefined
  /** Skill companion bytes keyed by `skill:<name>`; empty map for a companion-less skill. */
  companionBytes: Map<string, SkillCompanionBytes> | undefined
  serversDeclared: ReadonlyArray<string>
}

/**
 * Result of resolving a single facet through its source-kind resolver
 * (`resolveRegistryFacet` / `resolveGitFacet` / `resolveLocalFacet`).
 * Discriminated by `ok`; failures are the orchestrator-level
 * `RunInstallFailure` so the commit loop forwards them unchanged.
 */
export type ResolveFacetResult = { ok: true; value: ResolvedFacet } | { ok: false; failure: RunInstallFailure }
