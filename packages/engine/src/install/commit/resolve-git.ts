import { rm } from 'node:fs/promises'
import type { Adapter } from '@agent-facets/adapter'
import type { BuildManifest, LockfileSource, SupportedLockfileFacet } from '@agent-facets/protocol'
import { verifyGitOneCheck } from '@agent-facets/protocol'
import { runBuildPipeline } from '../../build/pipeline.ts'
import { type CacheIdentity, cachePutVerified } from '../../cache/index.ts'
import { cloneFacetGitSource } from '../../sources/facet/resolve-git.ts'
import type { Source } from '../../sources/facet/types.ts'
import { cloneFailureToRunInstall } from '../clone-failure.ts'
import { resolveCloneRef } from '../resolve-clone-ref.ts'
import type { OnLog, StageEvent } from '../types.ts'
import { buildVerifiedAssetPlan, readSkillCompanionBytes } from '../verified-asset-plan.ts'
import { buildLockfileSource, loadFacetContent } from './finalize-facet.ts'
import { auditedGitCacheLookup } from './git-cache.ts'
import type { ResolveFacetResult } from './types.ts'

export interface ResolveGitFacetArgs {
  facetName: string
  source: Extract<Source, { kind: 'git' }>
  adapters: ReadonlyArray<Adapter>
  /** See `ResolveRegistryFacetArgs.effectiveLocked`. */
  effectiveLocked: SupportedLockfileFacet | undefined
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Resolve a git facet: audited cache hit, or clone + build + verify.
 *
 * Cache hits are AUDITED, never trusted (design D4): the slot's
 * content is re-hashed against its integrity sidecar via
 * `auditCacheSlot` — the same self-audit recompute as the registry
 * chain. A failed audit (tampered bytes, missing/corrupt sidecar)
 * evicts the slot and degrades to a soft miss (re-clone). An audit
 * that passes but contradicts the locked integrity — a coordinated
 * bytes+sidecar rewrite — is the hard `CACHE_INTEGRITY_MISMATCH`.
 *
 * On a miss, the clone is pinned by `resolveCloneRef` (locked commit
 * over manifest ref), built, held to the git one-check reproduction
 * guard when a locked entry anchors it, and committed to the cache via
 * the verified-put. Git sources keep the one-check — registry-style
 * integrity confirmation does not apply (design non-goal).
 */
export async function resolveGitFacet(args: ResolveGitFacetArgs): Promise<ResolveFacetResult> {
  const { facetName, source, effectiveLocked, onStage, onLog } = args

  onStage({ kind: 'facet-stage', facet: facetName, stage: 'resolve' })

  /**
   * How the source tree was obtained. The values are coupled — an audited
   * cache hit has no commit to record and always has a locked entry behind
   * it; a clone always has a commit and never has one — so one arm each
   * makes the mismatched combinations unrepresentable. The ref is not
   * recorded in the lockfile (it's a manifest concern); only the resolved
   * commit is pinned.
   */
  type Acquisition =
    | { kind: 'audited-hit'; dir: string; locked: SupportedLockfileFacet }
    | { kind: 'cloned'; dir: string; commit: string }

  let acquisition: Acquisition | undefined
  /**
   * Deliberately permissive: a resource guard, not state. Armed when a
   * clone creates a temporary tree, DISARMED once those same bytes are
   * re-homed in a durable cache slot. `undefined` means "nothing to clean
   * up" — true both before arming and after disarming, and the two cases
   * are indistinguishable on purpose.
   */
  let cleanup: (() => Promise<void>) | undefined

  // Cache-first when a locked entry anchors this facet: name + version
  // are both known, so the slot can be consulted without any clone or
  // network round-trip. When the manifest source no longer matches the
  // locked source the discriminator already cleared `effectiveLocked`,
  // so a changed URL never serves bytes from the old origin's slot.
  if (effectiveLocked !== undefined) {
    const lookup = auditedGitCacheLookup(facetName, effectiveLocked, onLog)
    if (lookup.kind === 'mismatch') {
      return { ok: false, failure: lookup.failure }
    }
    if (lookup.kind === 'hit') {
      // No cleanup — cache entries are durable.
      acquisition = { kind: 'audited-hit', dir: lookup.slotPath, locked: effectiveLocked }
    }
  }

  // Cache miss (or no locked entry, or evicted slot). Clone.
  if (acquisition === undefined) {
    const cloneRef = resolveCloneRef(effectiveLocked, source.ref)
    const cloned = await cloneFacetGitSource(source.url, cloneRef)
    if (!cloned.ok) {
      return { ok: false, failure: cloneFailureToRunInstall(facetName, cloned) }
    }
    cleanup = async () => {
      await rm(cloned.dir, { recursive: true, force: true }).catch(() => {})
    }
    acquisition = { kind: 'cloned', dir: cloned.dir, commit: cloned.commit }
    onLog(() => `[verbose]   cloned ${source.url} → ${cloned.dir} (sha: ${cloned.commit})`)
  }

  // Reassigned once a fresh clone is re-homed into its durable cache slot,
  // so per-file records are always derived from the verified location.
  let sourceDir = acquisition.dir

  try {
    const content = await loadFacetContent(facetName, sourceDir, onStage)
    if (!content.ok) return content

    let identity: { source: LockfileSource; version: string; integrity: string }
    if (acquisition.kind === 'audited-hit') {
      // An audited hit already proved the slot reproduces the locked
      // integrity, so the locked identity carries forward in both modes.
      const { locked } = acquisition
      identity = { source: locked.source, version: locked.version, integrity: locked.integrity }
    } else {
      onStage({ kind: 'facet-stage', facet: facetName, stage: 'build' })
      const buildResult = await runBuildPipeline(sourceDir, [...args.adapters])
      if (!buildResult.ok) {
        return {
          ok: false,
          failure:
            buildResult.kind === 'adapter-incompatible'
              ? { code: 'ADAPTER_INCOMPATIBLE', failures: buildResult.failures }
              : { code: 'BUILD_FAILED', facet: facetName, errors: buildResult.errors },
        }
      }

      // Reproduction guard: a satisfying locked entry MUST reproduce its
      // locked integrity, or the install fails — do NOT cache, do NOT
      // write the lockfile, do NOT materialize. A git artifact that no
      // longer hashes to the locked integrity has been modified since we
      // locked it (a tag move).
      if (effectiveLocked !== undefined) {
        const guard = verifyGitOneCheck({
          facet: facetName,
          computedIntegrity: buildResult.integrity,
          lockfileIntegrity: effectiveLocked.integrity,
        })
        if (!guard.ok) {
          return { ok: false, failure: { code: 'INTEGRITY_FAILURE', failure: guard.failure } }
        }
      }

      // Fresh clone → audit-then-write to cache; disarm cleanup once the
      // content lives in a durable slot.
      const buildManifest = JSON.parse(buildResult.manifestJson) as BuildManifest
      const cacheId: CacheIdentity = { kind: 'git', name: facetName, version: buildResult.data.version }
      const putResult = cachePutVerified(
        cacheId,
        sourceDir,
        // The producer still emits legacy 0.1 manifests during the
        // consumer bridge, so the per-entry hash map is `assets`.
        { integrity: buildManifest.integrity, fileHashes: buildManifest.assets },
        buildResult.integrity,
        facetName,
      )
      if (!putResult.ok) {
        if ('corruption' in putResult) {
          return {
            ok: false,
            failure: {
              code: 'CACHE_INTEGRITY_MISMATCH',
              facet: facetName,
              slotPath: putResult.corruption.slotPath,
              cachedIntegrity: '<corrupt>',
              lockedIntegrity: buildResult.integrity,
            },
          }
        }
        return { ok: false, failure: { code: 'INTEGRITY_FAILURE', failure: putResult.integrity } }
      }
      sourceDir = putResult.path
      cleanup = undefined
      onLog(() => `[verbose]   cached ${facetName}@${buildResult.data.version} from clone`)

      // This branch is NOT frozen-exclusive in reverse: a frozen install
      // whose cache slot is cold or evicted clones and rebuilds here, which
      // is ordinary reproduction rather than drift. The one-check guard
      // above is what makes that safe — it fails only when the artifact no
      // longer hashes to the locked integrity, not merely because a rebuild
      // happened.
      if (effectiveLocked !== undefined) {
        // The build just reproduced the locked integrity, so identity stays
        // the lockfile's.
        identity = {
          source: effectiveLocked.source,
          version: effectiveLocked.version,
          integrity: effectiveLocked.integrity,
        }
      } else {
        const buildSource = buildLockfileSource(facetName, source, acquisition.commit)
        if (!buildSource.ok) {
          return { ok: false, failure: buildSource.failure }
        }
        identity = {
          source: buildSource.source,
          version: buildResult.data.version,
          integrity: buildResult.integrity,
        }
      }
    }

    // Derived from the verified location on every path — the audited cache
    // slot, or the durable slot a fresh clone was re-homed into above.
    const built = buildVerifiedAssetPlan(content.manifest, sourceDir)
    if (!built.ok) {
      return { ok: false, failure: { code: 'BUILD_FAILED', facet: facetName, errors: built.errors } }
    }
    const companionBytes = readSkillCompanionBytes(built.plan, sourceDir)
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
        servers: content.servers,
      },
    }
  } finally {
    if (cleanup) await cleanup()
  }
}
