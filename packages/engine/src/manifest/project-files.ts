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

/** Render a parse failure as a single actionable line for callers that need a string. */
export function describeManifestFailure(failure: ProjectManifestParseFailure): string {
  switch (failure.code) {
    case 'invalid-json':
      return `${FACETS_JSON_FILE} is malformed JSON: ${summarize(failure.errors)}`
    case 'duplicate-members':
      return `${FACETS_JSON_FILE} contains duplicate object member names: ${summarize(failure.errors)}`
    case 'unsupported-manifest-version':
      return (
        `${FACETS_JSON_FILE} declares an unsupported manifestVersion ` +
        `(${failure.observed ?? 'missing'}, this CLI supports ${failure.supported.join(', ')}). ` +
        `Upgrade the CLI, or remove the field to use the legacy unversioned format.`
      )
    case 'schema-violation':
      return `${FACETS_JSON_FILE} is invalid (manifestVersion ${failure.manifestVersion}): ${summarize(failure.errors)}`
  }
}

function summarize(errors: ReadonlyArray<{ message: string }>): string {
  return errors.map((e) => e.message).join('; ')
}
