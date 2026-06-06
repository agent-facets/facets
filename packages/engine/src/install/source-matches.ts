import type { LockfileSource } from '@agent-facets/protocol'
import { parseFacetSource } from '../sources/facet/parse-source.ts'
import type { Source } from '../sources/facet/types.ts'

/**
 * Does a parsed manifest `Source` match a locked tagged source?
 *
 * Compares canonical, post-parse values per kind so manifest shorthand
 * (`github:owner/repo`, a trailing `#ref`, or a `file:` prefix) matches the
 * provenance a fresh install wrote. `parseFacetSource` already strips refs
 * and expands `github:`/`file:` shorthands, so the manifest `source.url`/
 * `source.path` are canonical; we canonicalize the LOCKED side too so a
 * lockfile that stored a raw (un-normalized) string still compares equal.
 *
 *   - registry → kind match only. Registry version drift is governed by the
 *     `satisfies` check at the call sites, never by this helper.
 *   - git → canonical repository URL match (ref-independent; a ref is a
 *     manifest concern, not lockfile provenance).
 *   - local → resolved path match.
 */
export function sourceMatchesLockedSource(source: Source, lockedSource: LockfileSource): boolean {
  switch (source.kind) {
    case 'registry':
      return lockedSource.kind === 'registry'
    case 'git':
      return lockedSource.kind === 'git' && canonicalGitUrl(lockedSource.url) === source.url
    case 'local':
      return lockedSource.kind === 'local' && lockedSource.path === source.path
  }
}

/**
 * Reduce a stored git URL to its canonical parsed form. A locked URL
 * written by a fresh install is already canonical; an older/hand-written
 * lockfile may hold a `github:` shorthand or a `#ref` suffix, so we parse
 * it through the same grammar the manifest side uses. Falls back to the
 * raw string if it doesn't parse as a git source.
 */
function canonicalGitUrl(url: string): string {
  const parsed = parseFacetSource(url)
  return parsed.ok && parsed.value.kind === 'git' ? parsed.value.url : url
}
