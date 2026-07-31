import type { LockfileFacet } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { describeVersionSpec } from '../../registry/describe.ts'
import type { Addition, InstallDelta } from '../types.ts'

/**
 * The in-memory merge of the on-disk manifest and the plan phase's
 * delta — the commit phase's working "desired set".
 */
export interface MergedDelta {
  /** Normalized entries with additions upserted and removals deleted. */
  desiredFacets: Record<string, NormalizedFacetEntry>
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
 *
 * Re-adding or updating a facet changes only its SOURCE. Materialization
 * overrides are durable project intent, so an existing entry's overrides are
 * carried through untouched — changing where a facet comes from is not a
 * statement about how its assets should be named.
 */
export function mergeDeltaIntoManifest(
  facets: Readonly<Record<string, NormalizedFacetEntry>>,
  delta: InstallDelta,
): MergedDelta {
  const desiredFacets: Record<string, NormalizedFacetEntry> = {}
  for (const [name, entry] of Object.entries(facets)) {
    desiredFacets[name] = { source: entry.source, overrides: entry.overrides }
  }
  for (const addition of delta.additions) {
    const source =
      addition.source.kind === 'registry' ? describeVersionSpec(addition.source.version) : addition.specifier
    desiredFacets[addition.facetName] = {
      source,
      overrides: desiredFacets[addition.facetName]?.overrides,
    }
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
  desiredFacets: Record<string, NormalizedFacetEntry>,
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
      const entry = desiredFacets[addition.facetName]
      if (entry !== undefined) {
        // Pin the source only. Overrides are untouched for the same reason
        // they survive a source update.
        entry.source = lockEntry.version
      }
    }
  }
}
