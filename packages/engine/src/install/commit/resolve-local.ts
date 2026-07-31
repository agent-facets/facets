import type { Adapter } from '@agent-facets/adapter'
import type { LockfileSource, SupportedLockfileFacet } from '@agent-facets/protocol'
import { verifyLockfileOneCheck } from '@agent-facets/protocol'
import { runBuildPipeline } from '../../build/pipeline.ts'
import { resolveLocalFacetSource } from '../../sources/facet/resolve-local.ts'
import type { Source } from '../../sources/facet/types.ts'
import type { OnLog, StageEvent } from '../types.ts'
import { buildVerifiedAssetPlan, readSkillCompanionBytes } from '../verified-asset-plan.ts'
import { buildLockfileSource, loadFacetContent } from './finalize-facet.ts'
import type { ResolveFacetResult } from './types.ts'

export interface ResolveLocalFacetArgs {
  facetName: string
  source: Extract<Source, { kind: 'local' }>
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  /** See `ResolveRegistryFacetArgs.effectiveLocked`. */
  effectiveLocked: SupportedLockfileFacet | undefined
  /**
   * Frozen-lockfile mode. Local sources are mutable by design, so a
   * normal install rebuilds from disk and overwrites the entry. But
   * `--frozen-lockfile` promises bit-for-bit reproduction of the
   * lockfile, so a frozen install treats local like git: the on-disk
   * content must still hash to the locked integrity, or the install
   * fails with `INTEGRITY_FAILURE`; the entry is never rewritten.
   */
  frozenLockfile: boolean
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Resolve a local facet: containment-checked path resolution + build.
 *
 * Local sources stay trust-by-path (design non-goal: no integrity
 * confirmation, no caching). The only integrity obligation is the
 * frozen-mode reproduction guard described on `frozenLockfile`.
 */
export async function resolveLocalFacet(args: ResolveLocalFacetArgs): Promise<ResolveFacetResult> {
  const { facetName, source, projectRoot, effectiveLocked, frozenLockfile, onStage } = args

  onStage({ kind: 'facet-stage', facet: facetName, stage: 'resolve' })
  const local = await resolveLocalFacetSource(source.path, projectRoot)
  if (!local.ok) {
    return {
      ok: false,
      failure: { code: 'LOCAL_RESOLVE_FAILED', facet: facetName, cause: local.error },
    }
  }

  const content = await loadFacetContent(facetName, local.dir, onStage)
  if (!content.ok) return content

  onStage({ kind: 'facet-stage', facet: facetName, stage: 'build' })
  const buildResult = await runBuildPipeline(local.dir, [...args.adapters])
  if (!buildResult.ok) {
    return {
      ok: false,
      failure:
        buildResult.kind === 'adapter-incompatible'
          ? { code: 'ADAPTER_INCOMPATIBLE', failures: buildResult.failures }
          : { code: 'BUILD_FAILED', facet: facetName, errors: buildResult.errors },
    }
  }

  let identity: { source: LockfileSource; version: string; integrity: string }
  if (frozenLockfile && effectiveLocked !== undefined) {
    // Frozen reproduction guard. The verifier labels the failure
    // `lockfile` (built-vs-lockfile divergence) — reporting `git` here
    // would mislead the user, since nothing git happened.
    const guard = verifyLockfileOneCheck({
      facet: facetName,
      computedIntegrity: buildResult.integrity,
      lockfileIntegrity: effectiveLocked.integrity,
    })
    if (!guard.ok) {
      return { ok: false, failure: { code: 'INTEGRITY_FAILURE', failure: guard.failure } }
    }
    // Frozen keeps the locked identity; the build above already proved the
    // on-disk content reproduces it.
    identity = {
      source: effectiveLocked.source,
      version: effectiveLocked.version,
      integrity: effectiveLocked.integrity,
    }
  } else {
    // Non-frozen: local is mutable by design; the user owns the version and
    // content, and the lockfile follows what's on disk.
    const buildSource = buildLockfileSource(facetName, source, undefined)
    if (!buildSource.ok) {
      return { ok: false, failure: buildSource.failure }
    }
    identity = {
      source: buildSource.source,
      version: buildResult.data.version,
      integrity: buildResult.integrity,
    }
  }

  // Derived on both paths: the built directory is the verified content in
  // either mode, so Apply and reconciliation see the same inputs regardless.
  const built = buildVerifiedAssetPlan(content.manifest, local.dir)
  if (!built.ok) {
    return { ok: false, failure: { code: 'BUILD_FAILED', facet: facetName, errors: built.errors } }
  }
  const companionBytes = readSkillCompanionBytes(built.plan, local.dir)
  if (!companionBytes.ok) {
    return { ok: false, failure: { code: 'BUILD_FAILED', facet: facetName, errors: companionBytes.errors } }
  }

  return {
    ok: true,
    value: {
      ...identity,
      resolved: content.resolved,
      plan: built.plan,
      companionBytes: companionBytes.companions,
      serversDeclared: content.serversDeclared,
    },
  }
}
