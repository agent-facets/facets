import type { FacetsJson } from '@agent-facets/protocol'
import { loadFacetsJson } from '../../manifest/project-files.ts'
import type { Source } from '../../sources/facet/types.ts'
import type { Addition } from '../types.ts'
import { type ResolveNameFailure, resolveFacetName } from './resolve-name.ts'

/**
 * A source the user asked to add, with its already-parsed {@link Source}. The
 * prepare phase resolves the facet name itself (it may clone git / resolve
 * a local path to read the source's `facet.json`).
 */
export interface AddSource {
  /** The raw specifier as the user typed it (manifest value for git/local). */
  specifier: string
  /** The parsed source discriminant. */
  source: Source
}

export type AddPrepareFailure = ResolveNameFailure | { reason: 'manifest-read'; error: string }

export type PrepareAddResult =
  | { ok: true; additions: ReadonlyArray<Addition>; json: FacetsJson; existed: boolean }
  | { ok: false; failure: AddPrepareFailure }

/**
 * Resolve every source's facet name, load the project manifest, and build
 * the additions list. This is the expensive part of `facet add` — it may
 * clone git repos or resolve local paths to discover the facet name.
 *
 * Also loads and validates `facets.json` (a missing manifest is fine for
 * add — we'll create it; an invalid one is a hard error). Returns the
 * manifest state so the orchestrator and CLI can inspect it.
 *
 * Pure preparation: no manifest mutation, no install, no disk writes
 * to the project. Independently testable.
 *
 * Never throws.
 */
export async function prepareAdd(
  projectRoot: string,
  sources: ReadonlyArray<AddSource>,
  onLog?: (line: string) => void,
): Promise<PrepareAddResult> {
  // 1. Load the manifest (or note it doesn't exist yet).
  const loaded = loadFacetsJson(projectRoot)
  if (!loaded.ok) {
    return { ok: false, failure: { reason: 'manifest-read', error: loaded.error } }
  }
  const json: FacetsJson = loaded.existed ? loaded.data : { facets: {} }

  // 2. Resolve names for every source.
  const additions: Addition[] = []
  for (const entry of sources) {
    const nameResult = await resolveFacetName(entry.source, entry.specifier, onLog)
    if (!nameResult.ok) {
      return { ok: false, failure: nameResult.failure }
    }
    additions.push({
      facetName: nameResult.name,
      specifier: entry.specifier,
      source: entry.source,
    })
  }

  return { ok: true, additions, json, existed: loaded.existed }
}
