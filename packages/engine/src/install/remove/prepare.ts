import { FACETS_JSON_FILE } from '../../manifest/mutations.ts'
import { loadProjectManifest, type ManifestLoadFailure, manifestLoadFailure } from '../../manifest/project-files.ts'

/**
 * Structured failure for the pre-install phase of `runRemove`.
 */
export type RemovePrepareFailure = ManifestLoadFailure

/**
 * Result of {@link prepareRemove}: the read-only validation phase.
 *
 * Success carries NOTHING. The manifest it read is a snapshot from before the
 * install lock was taken, so every fact derived from it — which names are
 * declared, how many facets exist — is already potentially stale by the time
 * a caller could act on it. Returning those facts made it possible to decide
 * an outcome from them, which is exactly what the lock ordering exists to
 * prevent; not returning them makes that decision unrepresentable.
 */
export type RemovePrepareResult = { ok: true } | { ok: false; failure: RemovePrepareFailure }

/**
 * Read-only validation phase: can this project's `facets.json` be read at all?
 *
 * Extracted from `runRemove` so the CLI can report an unreadable or
 * unsupported manifest with the facet-shaped error, before adapter discovery
 * turns it into an adapter-shaped one. Performs no mutation. Never throws.
 */
export function prepareRemove(opts: { projectRoot: string; names: ReadonlyArray<string> }): RemovePrepareResult {
  const { projectRoot } = opts

  const loaded = loadProjectManifest(projectRoot)
  if (!loaded.ok) {
    return { ok: false, failure: manifestLoadFailure(projectRoot, loaded) }
  }
  if (!loaded.existed) {
    return { ok: false, failure: { reason: 'manifest-read', error: `no ${FACETS_JSON_FILE} found` } }
  }

  return { ok: true }
}
