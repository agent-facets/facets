import type { CurrentLockfileFacet } from '@agent-facets/protocol'
import type { NormalizedFacetEntry } from '../../manifest/mutations.ts'
import { describeVersionSpec } from '../../registry/describe.ts'
import type { RegistryMetadata } from '../../registry/types.ts'
import { ownEntry } from '../own-entry.ts'
import type { Addition, InstallOperation } from '../types.ts'

/**
 * How one desired facet should be resolved.
 *
 * A tag rather than a set of names on the side, because the three cases
 * differ in what they trust rather than in degree:
 *
 *   - `manifest`: ordinary reproduction. Parse the manifest value and
 *     honor a satisfying lock entry as the version anchor.
 *   - `refresh`: an explicit non-exact addition. Same parse, but the old
 *     lock entry must not answer the version question — the user just
 *     asked for it to be answered again.
 *   - `prepared`: a reviewed update. The exact release is already known
 *     and already confirmed by the registry, so nothing is re-resolved;
 *     the old lock entry is not the anchor, and the manifest value is
 *     what to persist rather than what to resolve.
 */
export type FacetResolutionIntent =
  | { kind: 'manifest' }
  | { kind: 'refresh' }
  | { kind: 'prepared'; metadata: RegistryMetadata }

/**
 * The in-memory merge of the on-disk manifest and this run's operation —
 * the commit phase's working "desired set".
 */
export interface MergedOperation {
  /** Normalized entries with additions upserted and removals deleted. */
  desiredFacets: Record<string, NormalizedFacetEntry>
  /** Per-facet resolution intent, keyed by facet name. */
  intents: Record<string, FacetResolutionIntent>
  /** Additions this run must apply the manifest-write policy to. */
  additions: ReadonlyArray<Addition>
}

/**
 * Merge the operation into the desired manifest in memory.
 *
 * Additions are upserted with the user's specifier; removals are
 * deleted; a reviewed update replaces only the facet's source with the
 * value the plan says to persist. The on-disk `facets.json` is NOT
 * written here — it is written as part of the transactional commit at
 * the end.
 *
 * Addition values are stored specifier-shaped (e.g. `1.2.3`, `latest`)
 * so `resolveFacet` can parse them; the final manifest value for a bare
 * add is computed by `applyManifestWritePolicy` after resolution
 * succeeds. An update's value needs no such second pass: its final form
 * was already derived from the authored specifier and the reviewed
 * version before the operation was constructed.
 *
 * Re-adding, updating, or re-sourcing a facet changes only its SOURCE.
 * Materialization overrides are durable project intent, so an existing
 * entry's overrides are carried through untouched — changing where a
 * facet comes from, or which version of it, is not a statement about how
 * its assets should be named.
 */
export function mergeOperationIntoManifest(
  facets: Readonly<Record<string, NormalizedFacetEntry>>,
  operation: InstallOperation,
): MergedOperation {
  // Null-prototype for the same reason `parseProjectManifest` uses one: this
  // map is rebuilt key-by-key from user-authored facet names, and an ordinary
  // `{}` would drop an own `__proto__` here even after normalization
  // preserved it — putting the fix one hop from where it is observable.
  const desiredFacets: Record<string, NormalizedFacetEntry> = Object.create(null)
  const intents: Record<string, FacetResolutionIntent> = Object.create(null)
  for (const [name, entry] of Object.entries(facets)) {
    desiredFacets[name] = { source: entry.source, overrides: entry.overrides }
    intents[name] = { kind: 'manifest' }
  }

  switch (operation.kind) {
    case 'reproduce':
      break
    case 'add':
      for (const addition of operation.additions) {
        const source =
          addition.source.kind === 'registry' ? describeVersionSpec(addition.source.version) : addition.specifier
        desiredFacets[addition.facetName] = {
          source,
          overrides: ownEntry(desiredFacets, addition.facetName)?.overrides,
        }
        intents[addition.facetName] = { kind: 'refresh' }
      }
      break
    case 'remove':
      for (const removal of operation.removals) {
        delete desiredFacets[removal.facetName]
        delete intents[removal.facetName]
      }
      break
    case 'update':
      for (const selection of operation.selections) {
        const existing = ownEntry(desiredFacets, selection.facetName)
        desiredFacets[selection.facetName] = {
          source: selection.manifestSource,
          overrides: existing?.overrides,
        }
        intents[selection.facetName] = { kind: 'prepared', metadata: selection.metadata }
      }
      break
  }

  return {
    desiredFacets,
    intents,
    additions: operation.kind === 'add' ? operation.additions : [],
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
 *   - Reproduction and update (not additions) → leave unchanged. An
 *     update's manifest value is decided before resolution, not after.
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
  newFacetEntries: Readonly<Record<string, CurrentLockfileFacet>>,
): void {
  for (const addition of additions) {
    const lockEntry = ownEntry(newFacetEntries, addition.facetName)
    if (lockEntry === undefined) continue
    const isBareAdd =
      addition.source.kind === 'registry' &&
      addition.source.version.kind === 'latest' &&
      addition.specifier === addition.facetName
    if (isBareAdd) {
      const entry = ownEntry(desiredFacets, addition.facetName)
      if (entry !== undefined) {
        // Pin the source only. Overrides are untouched for the same reason
        // they survive a source update.
        entry.source = lockEntry.version
      }
    }
  }
}
