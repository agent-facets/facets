import type { LockfileSource, ResolvedFacetManifest } from '@agent-facets/protocol'
import type { RunInstallFailure } from '../types.ts'
import type { SkillCompanionBytes, VerifiedAssetPlan } from '../verified-asset-plan.ts'

/**
 * What a per-source-kind resolver hands back to the commit orchestrator.
 *
 * Every field is present on every path. There is deliberately no "inherited
 * locked entry" arm: a resolver that returned identity without content made
 * the completeness of Apply's inputs depend on frozen mode and cache warmth,
 * which produced two real defects. Frozen reproduction skipped
 * pre-materialization reconciliation on a warm cache but performed it on a
 * cold one, and an absent companion map was indistinguishable from a skill
 * whose companion bundle is genuinely empty — so replacing a bundle could
 * remove every companion the previous install owned.
 *
 * Identity (`source`, `version`, `integrity`) still comes from the locked
 * entry when a facet is being reproduced; only the CONTENT is always
 * derived. Whether the lockfile is rewritten is a separate decision made at
 * commit time, and it never removes content Apply needs.
 *
 * Note what is absent: no lockfile entry and no materialization disposition.
 * Both depend on project intent, which resolution has not consulted. Compose
 * is the sole constructor of current lockfile entries.
 */
export interface ResolvedFacet {
  /** Provenance to record for this facet: registry, git, or local. */
  source: LockfileSource
  /** Resolved concrete `M.N.P` version. */
  version: string
  /** Facet-level archive integrity this resolution is anchored to. */
  integrity: string
  /** The manifest with authored prompt bodies loaded, for materialization. */
  resolved: ResolvedFacetManifest
  /** Canonical authored identities, paths, recomputed hashes, and ownership. */
  plan: VerifiedAssetPlan
  /** Keyed by `skill:<name>`; empty map for a companion-less skill. */
  companionBytes: Map<string, SkillCompanionBytes>
  serversDeclared: ReadonlyArray<string>
}

/**
 * Result of resolving a single facet through its source-kind resolver
 * (`resolveRegistryFacet` / `resolveGitFacet` / `resolveLocalFacet`).
 * Discriminated by `ok`; failures are the orchestrator-level
 * `RunInstallFailure` so the commit loop forwards them unchanged.
 */
export type ResolveFacetResult = { ok: true; value: ResolvedFacet } | { ok: false; failure: RunInstallFailure }
