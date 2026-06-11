import type { LockfileSource, ResolvedFacetManifest } from '@agent-facets/protocol'
import { loadManifest, resolvePrompts } from '../../loaders/facet.ts'
import { getRegistryBaseUrl } from '../../registry/index.ts'
import type { Source } from '../../sources/facet/types.ts'
import type { RunInstallFailure, StageEvent } from '../types.ts'

/**
 * Result of loading and validating a facet's content from a resolved
 * source directory. On success carries the prompt-resolved manifest
 * (what `materialize` consumes) and the facet's server declarations.
 */
export type LoadFacetContentResult =
  | { ok: true; resolved: ResolvedFacetManifest; serversDeclared: ReadonlyArray<string> }
  | { ok: false; failure: RunInstallFailure }

/**
 * The shared tail every source kind funnels through once its content
 * is resolved to a directory (cache slot, fresh clone, or local path):
 *
 *   1. Load and validate `facet.json` → `MANIFEST_LOAD_FAILED`.
 *   2. The manifest's `name` must equal the facets.json key →
 *      `MANIFEST_NAME_MISMATCH`.
 *   3. Facet composition is not supported → `COMPOSITION_REJECTED`.
 *   4. Resolve prompts (loads actual prompt bodies from disk) →
 *      `BUILD_FAILED`. Always runs — `materialize` reads prompt bodies
 *      from the resolved manifest on every path, including verified
 *      cache hits.
 */
export async function loadFacetContent(
  facetName: string,
  sourceDir: string,
  onStage: (event: StageEvent) => void,
): Promise<LoadFacetContentResult> {
  onStage({ kind: 'facet-stage', facet: facetName, stage: 'load' })
  const rawManifest = await loadManifest(sourceDir)
  if (!rawManifest.ok) {
    return {
      ok: false,
      failure: { code: 'MANIFEST_LOAD_FAILED', facet: facetName, errors: rawManifest.errors },
    }
  }
  if (rawManifest.data.name !== facetName) {
    return {
      ok: false,
      failure: {
        code: 'MANIFEST_NAME_MISMATCH',
        facet: facetName,
        manifestName: rawManifest.data.name,
      },
    }
  }
  if (rawManifest.data.facets && rawManifest.data.facets.length > 0) {
    return { ok: false, failure: { code: 'COMPOSITION_REJECTED', facet: facetName } }
  }

  const serversDeclared = rawManifest.data.servers ? Object.keys(rawManifest.data.servers) : []

  const resolved = await resolvePrompts(rawManifest.data, sourceDir)
  if (!resolved.ok) {
    return {
      ok: false,
      failure: { code: 'BUILD_FAILED', facet: facetName, errors: resolved.errors },
    }
  }

  return { ok: true, resolved: resolved.data, serversDeclared }
}

/**
 * Build the tagged lockfile `source` for a freshly-resolved
 * (non-locked) entry from the parsed source and, for git, the resolved
 * clone commit.
 *
 *   - registry → the registry origin (base URL) this run resolved
 *     against. The version is recorded in the entry's `version` field,
 *     never here.
 *   - git → the repository URL plus the required resolved commit. The
 *     commit is guaranteed by the clone contract on the build-derived
 *     path; a missing one is a programmer error and fails the install
 *     rather than writing a commitless (non-reproducible) entry.
 *   - local → the resolved path.
 */
export function buildLockfileSource(
  facetName: string,
  source: Source,
  clonedCommit: string | undefined,
): { ok: true; source: LockfileSource } | { ok: false; failure: RunInstallFailure } {
  switch (source.kind) {
    case 'registry':
      return { ok: true, source: { kind: 'registry', registry: getRegistryBaseUrl() } }
    case 'git':
      if (clonedCommit === undefined) {
        return {
          ok: false,
          failure: { code: 'GIT_COMMIT_UNRESOLVED', facet: facetName, url: source.url, stderr: '' },
        }
      }
      return { ok: true, source: { kind: 'git', url: source.url, commit: clonedCommit } }
    case 'local':
      return { ok: true, source: { kind: 'local', path: source.path } }
  }
}
