import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@agent-facets/common'
import type { ProjectManifestParseFailure } from '@agent-facets/protocol'
import {
  emptyProjectManifest,
  FACETS_JSON_FILE,
  type ManifestDocument,
  type NormalizedProjectManifest,
  parseProjectManifest,
  serializeProjectManifest,
} from './mutations.ts'

/**
 * Bridge between OS file I/O and the pure manifest helpers in
 * `manifest/mutations.ts`. Reads bytes, hands them to the parser, then writes
 * bytes back — never mutating parsed JSON directly.
 */

export type LoadProjectManifestResult =
  | { ok: true; manifest: NormalizedProjectManifest; existed: boolean }
  | { ok: false; reason: 'read'; error: string }
  | { ok: false; reason: 'invalid'; failure: ProjectManifestParseFailure }

/**
 * Read facets.json from a project root. Returns an empty current-version
 * skeleton when the file is absent (first `facet add` in a new project).
 *
 * Failures are split by cause rather than flattened into one message string:
 * a filesystem read error and a schema/version rejection call for different
 * guidance, and an unsupported `manifestVersion` must reach the caller as
 * structured data so it can report the observed and supported versions.
 */
export function loadProjectManifest(projectRoot: string): LoadProjectManifestResult {
  const path = join(projectRoot, FACETS_JSON_FILE)
  if (!existsSync(path)) {
    return { ok: true, manifest: emptyProjectManifest(), existed: false }
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return {
      ok: false,
      reason: 'read',
      error: `failed to read ${FACETS_JSON_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const parsed = parseProjectManifest(raw)
  if (!parsed.ok) {
    return { ok: false, reason: 'invalid', failure: parsed.failure }
  }
  return { ok: true, manifest: parsed.manifest, existed: true }
}

/**
 * Write facets.json to disk atomically (tmp file + rename).
 *
 * Takes the document rather than the normalized view: the document is the
 * thing that carries comment metadata, and serializing anything else would
 * silently drop it.
 */
export function writeProjectManifest(projectRoot: string, document: ManifestDocument): void {
  const path = join(projectRoot, FACETS_JSON_FILE)
  atomicWriteFileSync(path, serializeProjectManifest(document))
}

/**
 * The data an unsupported `manifestVersion` must carry to whoever reports it.
 *
 * Declared once and reused by every failure shape that can express it, so the
 * three fields cannot drift apart between the install orchestrator and the
 * prepare phases of add and remove.
 */
export interface UnsupportedManifestVersion {
  path: string
  observed: number | undefined
  supported: readonly number[]
}

/**
 * Every way loading `facets.json` can fail, as data rather than prose.
 *
 * The split is not cosmetic: a malformed document and a document this CLI is
 * too old to read need opposite remedies — fix the file versus upgrade the
 * tool — and only one of them can name the versions involved. Flattening both
 * into a message string is what made the upgrade guidance unreachable from
 * `facet add` and `facet remove`.
 */
export type ManifestLoadFailure =
  | { reason: 'manifest-read'; error: string }
  | ({ reason: 'manifest-unsupported-version' } & UnsupportedManifestVersion)

/** Convert a failed manifest load into the discriminated prepare failure. */
export function manifestLoadFailure(
  projectRoot: string,
  loaded: Extract<LoadProjectManifestResult, { ok: false }>,
): ManifestLoadFailure {
  if (loaded.reason === 'read') {
    return { reason: 'manifest-read', error: loaded.error }
  }
  if (loaded.failure.code === 'unsupported-manifest-version') {
    return {
      reason: 'manifest-unsupported-version',
      path: join(projectRoot, FACETS_JSON_FILE),
      observed: loaded.failure.observed,
      supported: loaded.failure.supported,
    }
  }
  return { reason: 'manifest-read', error: describeManifestFailure(loaded.failure) }
}

/**
 * A parse failure this module is allowed to turn into prose.
 *
 * An unsupported `manifestVersion` is excluded BY TYPE rather than by an
 * arm that promises never to run. It is the one failure whose remedy is not
 * "repair the document", and the only one whose report needs the observed
 * and supported versions as data — so it travels as
 * {@link UnsupportedManifestVersion} and is worded by whoever is reporting
 * to the user. Leaving a sentence for it here meant engine carried a second,
 * contradictory remedy ("remove the field") that survived only because every
 * caller happened to check for it first.
 */
type RenderableManifestFailure = Exclude<ProjectManifestParseFailure, { code: 'unsupported-manifest-version' }>

/** Render a parse failure as a single actionable line for callers that need a string. */
function describeManifestFailure(failure: RenderableManifestFailure): string {
  switch (failure.code) {
    case 'invalid-json':
      return `${FACETS_JSON_FILE} is malformed JSON: ${summarize(failure.errors)}`
    case 'duplicate-members':
      return `${FACETS_JSON_FILE} contains duplicate object member names: ${summarize(failure.errors)}`
    case 'schema-violation':
      return `${FACETS_JSON_FILE} is invalid (manifestVersion ${failure.manifestVersion}): ${summarize(failure.errors)}`
  }
}

function summarize(errors: ReadonlyArray<{ message: string }>): string {
  return errors.map((e) => e.message).join('; ')
}
