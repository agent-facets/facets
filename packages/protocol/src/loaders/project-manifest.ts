import type { ValidationError } from '@agent-facets/common'
import { type } from 'arktype'
import {
  CURRENT_PROJECT_MANIFEST_VERSION,
  type CurrentProjectManifest,
  CurrentProjectManifestSchema,
  LEGACY_PROJECT_MANIFEST_VERSION,
  type LegacyProjectManifest,
  LegacyProjectManifestSchema,
  SUPPORTED_PROJECT_MANIFEST_VERSIONS,
} from '../schemas/project-manifest.ts'
import { findDuplicateJsonMembers, mapArkErrors, parseJson } from './validate.ts'

/**
 * Structured failure data for project-manifest parsing. Every expected
 * failure mode is a tagged variant — no thrown errors, no message parsing.
 */
export type ProjectManifestParseFailure =
  /** The document is not valid JSON. */
  | { code: 'invalid-json'; errors: ValidationError[] }
  /** The document contains duplicate object member names (rejected before version dispatch). */
  | { code: 'duplicate-members'; errors: ValidationError[] }
  /** The declared `manifestVersion` is not a supported project-manifest schema version. */
  | { code: 'unsupported-manifest-version'; observed: number | undefined; supported: readonly number[] }
  /** The document selected a supported schema but violates it. */
  | {
      code: 'schema-violation'
      manifestVersion: typeof LEGACY_PROJECT_MANIFEST_VERSION | typeof CURRENT_PROJECT_MANIFEST_VERSION
      errors: ValidationError[]
    }

/**
 * A successfully parsed project manifest, tagged by the exact schema it was
 * validated under so downstream consumers dispatch exhaustively. A legacy
 * document's string-only entries can never be mistaken for current entries
 * that may carry materialization overrides.
 */
export type ParsedProjectManifest =
  | { manifestVersion: typeof LEGACY_PROJECT_MANIFEST_VERSION; manifest: LegacyProjectManifest }
  | { manifestVersion: typeof CURRENT_PROJECT_MANIFEST_VERSION; manifest: CurrentProjectManifest }

export type ParseProjectManifestResult =
  | { ok: true; data: ParsedProjectManifest }
  | { ok: false; failure: ProjectManifestParseFailure }

/**
 * Parses and validates a `facets.json` document with exact `manifestVersion`
 * dispatch (design D4):
 *
 *   1. JSON parse (syntax errors are structured failures).
 *   2. Reject duplicate object member names BEFORE version dispatch, so two
 *      conflicting materialization decisions for one asset cannot collapse
 *      through parser-specific last-member-wins behavior.
 *   3. Dispatch on `manifestVersion`: ABSENT selects the legacy unversioned
 *      schema, exactly numeric `0.1` selects the current schema, and any
 *      other declared value is a structured unsupported-version failure
 *      carrying the observed and supported versions.
 *
 * There is NO fallback or shape-sniffing between generations. A document
 * declaring `0.1` that violates the current schema fails as a `0.1`
 * violation and is never retried as legacy; an unversioned document
 * containing an expanded entry fails as legacy and is never promoted to
 * current.
 *
 * This validator is deliberately comment-unaware: it answers "is this
 * document valid, and what does it mean". A producer that must preserve
 * hand-written comments across a round-trip parses the same bytes with its
 * own comment-preserving reader and uses this result for meaning.
 */
export function parseProjectManifestDocument(bytes: Uint8Array | string): ParseProjectManifestResult {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)

  const jsonResult = parseJson(text)
  if (!jsonResult.ok) {
    return { ok: false, failure: { code: 'invalid-json', errors: jsonResult.errors } }
  }

  const duplicates = findDuplicateJsonMembers(text)
  if (duplicates.length > 0) {
    return { ok: false, failure: { code: 'duplicate-members', errors: duplicates } }
  }

  const declaresVersion =
    typeof jsonResult.data === 'object' && jsonResult.data !== null && 'manifestVersion' in jsonResult.data
  const observedVersion = declaresVersion
    ? (jsonResult.data as { manifestVersion?: unknown }).manifestVersion
    : undefined

  if (!declaresVersion) {
    const validated = LegacyProjectManifestSchema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: {
          code: 'schema-violation',
          manifestVersion: LEGACY_PROJECT_MANIFEST_VERSION,
          errors: mapArkErrors(validated),
        },
      }
    }
    return { ok: true, data: { manifestVersion: LEGACY_PROJECT_MANIFEST_VERSION, manifest: validated } }
  }

  if (observedVersion === CURRENT_PROJECT_MANIFEST_VERSION) {
    const validated = CurrentProjectManifestSchema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: {
          code: 'schema-violation',
          manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION,
          errors: mapArkErrors(validated),
        },
      }
    }
    return { ok: true, data: { manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION, manifest: validated } }
  }

  return {
    ok: false,
    failure: {
      code: 'unsupported-manifest-version',
      observed: typeof observedVersion === 'number' ? observedVersion : undefined,
      supported: SUPPORTED_PROJECT_MANIFEST_VERSIONS,
    },
  }
}
