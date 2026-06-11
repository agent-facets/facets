import type { LockfileFacet } from '@agent-facets/protocol'
import { describeVersionSpec } from '../../registry/describe.ts'
import type { Addition, InstallDelta } from '../types.ts'

/**
 * The in-memory merge of the on-disk manifest and the plan phase's
 * delta — the commit phase's working "desired set".
 */
export interface MergedDelta {
  /** Manifest map (name → specifier) with additions upserted and removals deleted. */
  desiredFacets: Record<string, string>
  /** Names arriving through `delta.additions` — the structural discriminator's input channel. */
  additionNames: ReadonlySet<string>
  hasDelta: boolean
}

/**
 * Merge the delta into the desired manifest in memory.
 *
 * Additions are upserted with the user's specifier; removals are
 * deleted. The on-disk `facets.json` is NOT written here — it is
 * written as part of the transactional commit at the end. Addition
 * values are stored specifier-shaped (e.g. `1.2.3`, `latest`) so
 * `resolveFacet` can parse them; the final manifest value is computed
 * by `applyManifestWritePolicy` after resolution succeeds.
 */
export function mergeDeltaIntoManifest(facets: Readonly<Record<string, string>>, delta: InstallDelta): MergedDelta {
  const desiredFacets: Record<string, string> = { ...facets }
  for (const addition of delta.additions) {
    const manifestValue =
      addition.source.kind === 'registry' ? describeVersionSpec(addition.source.version) : addition.specifier
    desiredFacets[addition.facetName] = manifestValue
  }
  for (const removal of delta.removals) {
    delete desiredFacets[removal.facetName]
  }
  return {
    desiredFacets,
    additionNames: new Set(delta.additions.map((a) => a.facetName)),
    hasDelta: delta.additions.length > 0 || delta.removals.length > 0,
  }
}

/**
 * Apply the manifest-write policy for additions before the tri-write —
 * the only place bare and `@latest` diverge:
 *
 *   - Bare registry add (`facet add cowsay`) → pin to the resolved
 *     exact version.
 *   - Explicit registry specifier (`1.2.3`, `0.*`, `*`, `latest`) →
 *     write verbatim (already in `desiredFacets`); `@latest` and
 *     wildcards float.
 *   - Git/local → write the specifier verbatim (already in
 *     `desiredFacets`).
 *   - Reproduction (not an addition) → leave unchanged.
 *
 * Bare and explicit `@latest` both PARSE to `kind: 'latest'`, so the
 * parsed source cannot distinguish them — the verbatim specifier can:
 * a bare add's specifier is exactly the facet name, with no `@version`
 * suffix. This is why the plan phase carries the specifier verbatim.
 *
 * Mutates `desiredFacets` in place.
 */
export function applyManifestWritePolicy(
  desiredFacets: Record<string, string>,
  additions: ReadonlyArray<Addition>,
  newFacetEntries: Readonly<Record<string, LockfileFacet>>,
): void {
  for (const addition of additions) {
    const lockEntry = newFacetEntries[addition.facetName]
    if (lockEntry === undefined) continue
    const isBareAdd =
      addition.source.kind === 'registry' &&
      addition.source.version.kind === 'latest' &&
      addition.specifier === addition.facetName
    if (isBareAdd) {
      desiredFacets[addition.facetName] = lockEntry.version
    }
  }
}
