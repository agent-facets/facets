import type { FacetsJson } from '@agent-facets/protocol'
import { FACETS_JSON_FILE } from '../../manifest/mutations.ts'
import { loadFacetsJson } from '../../manifest/project-files.ts'

/**
 * Structured failure for the pre-install phase of `runRemove`.
 */
export type RemovePrepareFailure = { reason: 'manifest-read'; error: string }

/**
 * Result of {@link prepareRemove}: the read-only validation phase.
 * On success carries the filtered names of facets to remove.
 */
export type RemovePrepareResult =
  | { ok: true; json: FacetsJson; names: ReadonlyArray<string> }
  | { ok: false; failure: RemovePrepareFailure }

/**
 * Read-only validation phase. Loads `facets.json`, filters names to those
 * actually declared (silently ignoring absent names).
 *
 * Extracted from `runRemove` so the CLI can run it before discovering
 * adapters. Performs no mutation. Never throws.
 */
export function prepareRemove(opts: { projectRoot: string; names: ReadonlyArray<string> }): RemovePrepareResult {
  const { projectRoot, names } = opts

  const loaded = loadFacetsJson(projectRoot)
  if (!loaded.ok) {
    return { ok: false, failure: { reason: 'manifest-read', error: loaded.error } }
  }
  if (!loaded.existed) {
    return { ok: false, failure: { reason: 'manifest-read', error: `no ${FACETS_JSON_FILE} found` } }
  }
  const json = loaded.data

  const present = names.filter((name) => Object.hasOwn(json.facets, name))
  return { ok: true, json, names: present }
}
