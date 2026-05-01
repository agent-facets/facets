import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@agent-facets/common'
import type { FacetsJson } from '../schemas/project-manifest.ts'
import { emptyFacetsJson, FACETS_JSON_FILE, parseFacetsJson, serializeFacetsJson } from './mutations.ts'

/**
 * Bridge between OS file I/O and the pure JSON mutation helpers in
 * `manifest/mutations.ts`. Reads bytes, hands them to the parsers,
 * then writes bytes back — never mutating parsed JSON directly.
 */

export type LoadFacetsJsonResult = { ok: true; data: FacetsJson; existed: boolean } | { ok: false; error: string }

/**
 * Read facets.json from a project root. Returns an empty skeleton when the
 * file is absent (first `facet add` in a new project). Validation failures
 * bubble up as error messages.
 */
export function loadFacetsJson(projectRoot: string): LoadFacetsJsonResult {
  const path = join(projectRoot, FACETS_JSON_FILE)
  if (!existsSync(path)) {
    return { ok: true, data: emptyFacetsJson(), existed: false }
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return {
      ok: false,
      error: `failed to read ${FACETS_JSON_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const parsed = parseFacetsJson(raw)
  if (!parsed.ok) {
    const details = parsed.errors.map((e) => e.message).join('; ')
    return { ok: false, error: `${FACETS_JSON_FILE} is invalid: ${details}` }
  }
  return { ok: true, data: parsed.data, existed: true }
}

/**
 * Write facets.json to disk atomically (tmp file + rename). Comments in the
 * parsed value survive the round-trip because core's serializer uses
 * comment-json.
 */
export function writeFacetsJson(projectRoot: string, json: FacetsJson): void {
  const path = join(projectRoot, FACETS_JSON_FILE)
  atomicWriteFileSync(path, serializeFacetsJson(json))
}
