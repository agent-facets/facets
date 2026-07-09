import type { Validated } from '@agent-facets/common'
import { type FacetsJson, FacetsJsonSchema, mapArkErrors } from '@agent-facets/protocol'
import { type } from 'arktype'
import { parse as parseCommentJson, stringify as stringifyCommentJson } from 'comment-json'

export const FACETS_JSON_FILE = 'facets.json'

/**
 * Pure manifest mutations for facets.json.
 *
 * Core owns all JSON reading/writing logic (Adjustment M). CLI is presentation
 * + OS I/O only and never imports comment-json or touches the parsed shape.
 *
 * Comments in hand-edited facets.json files survive round-trips: comment-json
 * stores comment metadata on Symbol-keyed properties that persist through
 * direct key assignment and deletion. We never clone via spread — that would
 * drop the comment symbols.
 */

/**
 * Parse facets.json bytes and validate against FacetsJsonSchema.
 *
 * Returns the parsed value with comment metadata preserved (safe to mutate
 * in place and re-serialize with {@link serializeFacetsJson}).
 */
export function parseFacetsJson(raw: string): Validated<FacetsJson> {
  let parsed: unknown
  try {
    parsed = parseCommentJson(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown JSON parse error'
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: `facets.json syntax error: ${message}`,
          expected: 'valid JSON',
          actual: 'malformed JSON',
        },
      ],
    }
  }

  const validated = FacetsJsonSchema(parsed)
  if (validated instanceof type.errors) {
    return { ok: false, errors: mapArkErrors(validated) }
  }

  return { ok: true, data: validated as FacetsJson }
}

/**
 * Serialize a FacetsJson value back to bytes, preserving any comment metadata
 * the value carries. Uses 2-space indentation to match ADR-006.
 *
 * Deliberately does NOT go through engine's `jsonFileText` helper: it must
 * serialize via comment-json to preserve comments, so it upholds the same
 * invariant (2-space indent, trailing newline) independently.
 */
export function serializeFacetsJson(json: FacetsJson): string {
  return `${stringifyCommentJson(json, null, 2)}\n`
}

/**
 * Return an empty FacetsJson skeleton. Used when `facet add` runs against a
 * directory with no existing facets.json.
 */
export function emptyFacetsJson(): FacetsJson {
  return { facets: {} }
}

/**
 * Insert or replace a facet entry in facets.json.
 *
 * Mutates `json` in place so any comments attached to other keys are
 * preserved. Returns the same object for convenience.
 */
export function upsertFacetInManifest(json: FacetsJson, name: string, source: string): FacetsJson {
  json.facets[name] = source
  return json
}

/**
 * Remove a facet entry from facets.json.
 *
 * Mutates `json` in place. Returns the same object for convenience. No-op if
 * the entry is absent (idempotent by design — `facet remove` should be safe
 * to re-run).
 */
export function removeFacetFromManifest(json: FacetsJson, name: string): FacetsJson {
  delete json.facets[name]
  return json
}
