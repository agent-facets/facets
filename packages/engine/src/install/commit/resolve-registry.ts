import type { LockfileFacet } from '@agent-facets/protocol'
import { cacheGet } from '../../cache/index.ts'
import { describeVersionSpec } from '../../registry/describe.ts'
import { getRegistryBaseUrl } from '../../registry/index.ts'
import type { RegistryMetadata } from '../../registry/types.ts'
import type { Source } from '../../sources/facet/types.ts'
import { computeAssetList } from '../materialize.ts'
import type { ConfirmingMiss, LockedMiss, MaterializeVersionInput } from '../materialize-version/index.ts'
import { materializeVersion } from '../materialize-version/index.ts'
import { parseLockedVersion } from '../parse-locked-version.ts'
import type { OnLog, StageEvent } from '../types.ts'
import { loadFacetContent } from './finalize-facet.ts'
import { chainFailureToRunInstall, fetchMeta } from './registry-support.ts'
import type { ResolveFacetResult } from './types.ts'

export interface ResolveRegistryFacetArgs {
  facetName: string
  source: Extract<Source, { kind: 'registry' }>
  /**
   * The lockfile entry that anchors this facet, post structural
   * discriminator (`resolveEffectiveLocked`). When defined, the entry
   * is the trust anchor: its version pins resolution and its integrity
   * is what the content must reproduce. When `undefined`, a lockfile
   * entry is being created — which requires same-operation registry
   * confirmation.
   */
  effectiveLocked: LockfileFacet | undefined
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Resolve a registry facet through the normative per-version
 * materialization chain (`diagrams/committing.md`):
 *
 *   1. **Exact-version gate.** A satisfying lockfile entry supplies the
 *      exact version (no version resolution); an exact specifier
 *      supplies it directly; anything else (`bare`, `latest`, `*`,
 *      `0.*`) resolves against the registry — and the metadata response
 *      carries the confirmation fingerprint, so confirmation rides
 *      version resolution for free (design D3).
 *   2. **Cache lookup keyed on the version** — never on a lockfile
 *      entry. This is what makes an exact-version add cache-first.
 *   3. **The four-variant chain** (`materializeVersion`): cache hits
 *      are self-audited and anchored (locked integrity or registry
 *      confirmation); misses download and run the three-check.
 *   4. **Tampered-slot retry**: a failed self-audit evicts the slot, so
 *      the chain is retried exactly once as a miss.
 *
 * Failure identities: an unreachable registry during confirming-hit
 * confirmation is `CONFIRMATION_UNAVAILABLE` (nothing needed
 * downloading — the only missing piece was the registry's published
 * fingerprint); an unreachable registry on any path that must download
 * is `REGISTRY_ERROR`. A confirmation mismatch is `INTEGRITY_FAILURE`
 * with Check A semantics. An audited hit that contradicts the lockfile
 * is the hard `CACHE_INTEGRITY_MISMATCH` (never a silent re-download).
 */
export async function resolveRegistryFacet(args: ResolveRegistryFacetArgs): Promise<ResolveFacetResult> {
  const { facetName, source, effectiveLocked, onStage, onLog } = args

  onStage({ kind: 'facet-stage', facet: facetName, stage: 'resolve' })

  // 1. Exact-version gate.
  let meta: RegistryMetadata | undefined
  let exactVersion: string
  if (effectiveLocked !== undefined) {
    // Reproduction: the lockfile already records the exact version.
    // No version resolution — and on a warm cache, no network at all.
    exactVersion = effectiveLocked.version
  } else if (source.version.kind === 'exact') {
    // An exact specifier needs no version resolution either; the cache
    // can be consulted before any network interaction.
    exactVersion = describeVersionSpec(source.version)
  } else {
    // Non-exact and unlocked (or an explicit non-exact addition, which
    // arrives here with `effectiveLocked === undefined` by the
    // structural discriminator): resolve fresh. Confirmation rides this
    // same response.
    const metaResult = await fetchMeta(facetName, source.version, onStage, onLog)
    if (!metaResult.ok) {
      return { ok: false, failure: { code: 'REGISTRY_ERROR', facet: facetName, error: metaResult.error } }
    }
    meta = metaResult.value
    exactVersion = meta.version
    onLog(() => `[verbose]   resolved ${facetName} ${describeVersionSpec(source.version)} → ${exactVersion}`)
  }

  // Lazily fetch (at most once) the metadata for the exact version —
  // needed for confirming-hit confirmation and for any download.
  const ensureMeta = async (): ReturnType<typeof fetchMeta> => {
    if (meta !== undefined) return { ok: true, value: meta }
    const result = await fetchMeta(facetName, parseLockedVersion(exactVersion), onStage, onLog)
    if (result.ok) meta = result.value
    return result
  }

  const missInput = (m: RegistryMetadata): LockedMiss | ConfirmingMiss =>
    effectiveLocked !== undefined
      ? {
          kind: 'locked-miss',
          facetName,
          version: exactVersion,
          transportHash: m.transportHash,
          contentFingerprint: m.contentFingerprint,
          lockfileIntegrity: effectiveLocked.integrity,
        }
      : {
          kind: 'confirming-miss',
          facetName,
          version: exactVersion,
          transportHash: m.transportHash,
          contentFingerprint: m.contentFingerprint,
        }

  // 2. Cache lookup keyed on the version.
  const lookup = cacheGet({ kind: 'registry', name: facetName, version: exactVersion })

  // 3. Construct the chain input.
  let input: MaterializeVersionInput
  if (lookup.hit && effectiveLocked !== undefined) {
    input = {
      kind: 'locked-hit',
      facetName,
      version: exactVersion,
      slotPath: lookup.path,
      lockfileIntegrity: effectiveLocked.integrity,
    }
  } else if (lookup.hit) {
    // Confirming-hit: the content is on hand, but a lockfile entry is
    // being created — integrity confirmation is mandatory and fails
    // closed when the registry is unreachable (design D3: no offline
    // TOFU; the trust anchor is the registry at lock time).
    const m = await ensureMeta()
    if (!m.ok) {
      return {
        ok: false,
        failure: { code: 'CONFIRMATION_UNAVAILABLE', facet: facetName, version: exactVersion, error: m.error },
      }
    }
    input = {
      kind: 'confirming-hit',
      facetName,
      version: exactVersion,
      slotPath: lookup.path,
      contentFingerprint: m.value.contentFingerprint,
    }
  } else {
    // Miss: archive resolution needs the metadata regardless (transport
    // hash) — an unreachable registry here is a download failure.
    const m = await ensureMeta()
    if (!m.ok) {
      return { ok: false, failure: { code: 'REGISTRY_ERROR', facet: facetName, error: m.error } }
    }
    input = missInput(m.value)
  }

  // Log cache hit/miss for verbose diagnostics.
  if (lookup.hit) {
    onLog(() => `[verbose]   cache hit ${facetName}@${exactVersion}`)
  } else {
    onLog(() => `[verbose]   cache miss ${facetName}@${exactVersion}; downloading`)
  }

  // 4. Run the chain; retry once as a miss after a tampered-slot evict.
  onStage({ kind: 'facet-stage', facet: facetName, stage: 'verify' })
  let result = await materializeVersion(input)
  if (!result.ok && result.code === 'cache-tampered') {
    onLog(() => `[verbose]   cache slot for ${facetName}@${exactVersion} failed its self-audit; evicted, refetching`)
    const m = await ensureMeta()
    if (!m.ok) {
      return { ok: false, failure: { code: 'REGISTRY_ERROR', facet: facetName, error: m.error } }
    }
    result = await materializeVersion(missInput(m.value))
  }
  if (!result.ok) {
    return { ok: false, failure: chainFailureToRunInstall(facetName, result) }
  }
  onLog(() => `[verbose]   materialized ${facetName}@${exactVersion} from ${result.slotPath}`)
  if (!lookup.hit) {
    onLog(() => `[verbose]   downloaded + cached ${facetName}@${exactVersion}`)
  }

  // Finalize from the verified slot.
  const content = await loadFacetContent(facetName, result.slotPath, onStage)
  if (!content.ok) return content

  const entry: LockfileFacet =
    effectiveLocked !== undefined
      ? {
          // Locked paths inherit the entry verbatim: the chain just
          // proved the content reproduces it, and the lockfile is the
          // source of truth — never rewritten on reproduction.
          source: effectiveLocked.source,
          version: effectiveLocked.version,
          integrity: effectiveLocked.integrity,
          assets: effectiveLocked.assets,
        }
      : {
          // Confirming paths create the entry from the resolved exact
          // version and the chain's verified integrity.
          source: { kind: 'registry', registry: getRegistryBaseUrl() },
          version: exactVersion,
          integrity: result.integrity,
          assets: computeAssetList(content.resolved),
        }

  return { ok: true, value: { entry, resolved: content.resolved, serversDeclared: content.serversDeclared } }
}
