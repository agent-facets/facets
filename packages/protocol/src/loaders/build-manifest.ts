import type { ValidationError } from '@agent-facets/common'
import { type } from 'arktype'
import {
  type CurrentBuildManifest,
  CurrentBuildManifestSchema,
  FACET_ARCHIVE_VERSION,
  LEGACY_FACET_ARCHIVE_VERSION,
  type LegacyBuildManifest,
  LegacyBuildManifestSchema,
  SUPPORTED_FACET_VERSIONS,
} from '../schemas/build-manifest.ts'
import { findDuplicateJsonMembers, mapArkErrors, parseJson } from './validate.ts'

/**
 * Structured failure data for build-manifest parsing. Every expected failure
 * mode is a tagged variant — no thrown errors, no message parsing.
 */
export type BuildManifestParseFailure =
  /** The document is not valid JSON. */
  | { code: 'invalid-json'; errors: ValidationError[] }
  /** The document contains duplicate object member names (rejected before schema validation). */
  | { code: 'duplicate-members'; errors: ValidationError[] }
  /** The declared `facetVersion` is not a supported archive format. */
  | { code: 'unsupported-facet-version'; observed: number | undefined; supported: readonly number[] }
  /** The document declared a supported version but violates that version's schema. */
  | { code: 'schema-violation'; facetVersion: number; errors: ValidationError[] }

/**
 * A successfully parsed build manifest, tagged by its exact archive format
 * version so downstream consumers dispatch exhaustively and never treat one
 * format's fields as the other's.
 */
export type ParsedBuildManifest =
  | { facetVersion: typeof LEGACY_FACET_ARCHIVE_VERSION; manifest: LegacyBuildManifest }
  | { facetVersion: typeof FACET_ARCHIVE_VERSION; manifest: CurrentBuildManifest }

export type ParseBuildManifestResult =
  | { ok: true; data: ParsedBuildManifest }
  | { ok: false; failure: BuildManifestParseFailure }

/**
 * Parses and validates a `build-manifest.json` document with exact
 * `facetVersion` dispatch (design D4):
 *
 *   1. JSON parse (syntax errors are structured failures).
 *   2. Reject duplicate object member names before schema validation.
 *   3. Dispatch on `facetVersion` by exact equality — `0.1` selects the
 *      legacy schema, `0.2` the current schema, anything else is a
 *      structured unsupported-version failure carrying the observed and
 *      supported versions.
 *
 * There is NO fallback between versions: a malformed `0.2` manifest fails
 * as a `0.2` schema violation and is never reinterpreted as `0.1`.
 */
export function parseBuildManifestDocument(bytes: Uint8Array | string): ParseBuildManifestResult {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)

  const jsonResult = parseJson(text)
  if (!jsonResult.ok) {
    return { ok: false, failure: { code: 'invalid-json', errors: jsonResult.errors } }
  }

  const duplicates = findDuplicateJsonMembers(text)
  if (duplicates.length > 0) {
    return { ok: false, failure: { code: 'duplicate-members', errors: duplicates } }
  }

  const observedVersion =
    typeof jsonResult.data === 'object' && jsonResult.data !== null && 'facetVersion' in jsonResult.data
      ? (jsonResult.data as { facetVersion?: unknown }).facetVersion
      : undefined

  if (observedVersion === LEGACY_FACET_ARCHIVE_VERSION) {
    const validated = LegacyBuildManifestSchema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: {
          code: 'schema-violation',
          facetVersion: LEGACY_FACET_ARCHIVE_VERSION,
          errors: mapArkErrors(validated),
        },
      }
    }
    return { ok: true, data: { facetVersion: LEGACY_FACET_ARCHIVE_VERSION, manifest: validated } }
  }

  if (observedVersion === FACET_ARCHIVE_VERSION) {
    const validated = CurrentBuildManifestSchema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: { code: 'schema-violation', facetVersion: FACET_ARCHIVE_VERSION, errors: mapArkErrors(validated) },
      }
    }
    return { ok: true, data: { facetVersion: FACET_ARCHIVE_VERSION, manifest: validated } }
  }

  return {
    ok: false,
    failure: {
      code: 'unsupported-facet-version',
      observed: typeof observedVersion === 'number' ? observedVersion : undefined,
      supported: SUPPORTED_FACET_VERSIONS,
    },
  }
}
