import type { SupportedLockfileFacet } from '@agent-facets/protocol'
import { satisfies } from '@agent-facets/protocol'
import type { Source } from '../../sources/facet/types.ts'
import { parseLockedVersion } from '../parse-locked-version.ts'
import { sourceMatchesLockedSource } from '../source-matches.ts'
import type { FacetResolutionIntent } from './delta.ts'

/**
 * Decide whether a lockfile entry still anchors this facet for the
 * current commit — the single home of the structural discriminator.
 *
 * Returns `undefined` when the entry must NOT constrain resolution,
 * in which case the caller treats the facet like a fresh add: no cache
 * lookup by the old version, no clone at the old commit, no integrity
 * check against bytes from the old source. Four reasons:
 *
 *   - **A reviewed update**: the exact release to install was already
 *     chosen and confirmed, so the old entry answers nothing. Unlike
 *     the addition case below, this holds even when the new manifest
 *     value is an exact pin — the whole point of the operation is that
 *     the version is changing, so a satisfying old entry would be a
 *     coincidence, not an anchor. Clearing it is also what keeps the
 *     old integrity from becoming the trust anchor for new content.
 *   - **Non-exact explicit addition** (the structural discriminator):
 *     an addition with a `bare`, `latest`, `*`, or `0.*` registry
 *     specifier never trusts the lockfile for version resolution —
 *     the user asked for a re-resolve, so the newest matching version
 *     wins even when the locked one satisfies. An EXACT specifier in
 *     an addition still benefits from a satisfying entry (the locked
 *     integrity is the trust anchor; no version resolution is needed
 *     either way).
 *   - **Stale registry entry**: the locked version no longer satisfies
 *     the manifest spec (hand-edit / pull / merge).
 *   - **Changed git source**: the parsed manifest source no longer
 *     matches the locked provenance; the old commit/integrity belong
 *     to the old origin. Canonical (post-parse) URLs are compared so a
 *     manifest shorthand (`github:owner/repo`, a `#ref` suffix) matches
 *     the provenance a fresh install wrote.
 *
 * Clearing the ANCHOR is not the same as forgetting the entry. The prior
 * lockfile entry is read separately by `resolveAll` and still reaches
 * ownership reconciliation and outcome classification, which is how an
 * update can report the version it moved away from.
 *
 * Local entries are intentionally never stale here. Non-frozen local
 * installs rebuild from disk and overwrite the entry; frozen installs
 * reject source drift in the preflight before the commit loop runs.
 *
 * Pure function — exported for unit testing.
 */
export function resolveEffectiveLocked(args: {
  locked: SupportedLockfileFacet | undefined
  source: Source
  intent: FacetResolutionIntent
}): SupportedLockfileFacet | undefined {
  const { locked, source, intent } = args

  if (intent.kind === 'prepared') {
    return undefined
  }

  if (intent.kind === 'refresh' && source.kind === 'registry' && source.version.kind !== 'exact') {
    return undefined
  }

  const isRegistryStale =
    locked !== undefined && source.kind === 'registry' && !satisfies(parseLockedVersion(locked.version), source.version)
  const isGitSourceChanged =
    locked !== undefined && source.kind === 'git' && !sourceMatchesLockedSource(source, locked.source)

  return isRegistryStale || isGitSourceChanged ? undefined : locked
}
