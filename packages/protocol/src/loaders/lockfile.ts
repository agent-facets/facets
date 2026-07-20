import type { ValidationError } from '@agent-facets/common'
import { type } from 'arktype'
import {
  CURRENT_LOCKFILE_VERSION,
  type CurrentLockfile,
  CurrentLockfileSchema,
  LEGACY_LOCKFILE_VERSION,
  type LegacyLockfile,
  LegacyLockfileSchema,
  SUPPORTED_LOCKFILE_VERSIONS,
} from '../schemas/lockfile.ts'
import { findDuplicateJsonMembers, mapArkErrors, parseJson } from './validate.ts'

/**
 * Structured failure data for lockfile parsing. Every expected failure mode
 * is a tagged variant — no thrown errors, no message parsing.
 */
export type LockfileParseFailure =
  /** The document is not valid JSON. */
  | { code: 'invalid-json'; errors: ValidationError[] }
  /** The document contains duplicate object member names (rejected before schema validation). */
  | { code: 'duplicate-members'; errors: ValidationError[] }
  /** The declared `lockfileVersion` is not a supported lockfile schema version. */
  | { code: 'unsupported-lockfile-version'; observed: number | undefined; supported: readonly number[] }
  /** The document declared a supported version but violates that version's schema. */
  | { code: 'schema-violation'; lockfileVersion: number; errors: ValidationError[] }

/**
 * A successfully parsed lockfile, tagged by its exact schema version so
 * downstream consumers dispatch exhaustively — legacy identity-only asset
 * entries can never be mistaken for current per-file-integrity entries.
 */
export type ParsedLockfile =
  | { lockfileVersion: typeof LEGACY_LOCKFILE_VERSION; lockfile: LegacyLockfile }
  | { lockfileVersion: typeof CURRENT_LOCKFILE_VERSION; lockfile: CurrentLockfile }

export type ParseLockfileResult = { ok: true; data: ParsedLockfile } | { ok: false; failure: LockfileParseFailure }

/**
 * Parses and validates a `facets.lock` document with exact version dispatch
 * (design D10):
 *
 *   1. JSON parse (syntax errors are structured failures).
 *   2. Reject duplicate object member names before schema validation.
 *   3. Dispatch on `lockfileVersion` by EXACT equality, never numeric
 *      ordering — legacy numeric `1` selects only the previous alpha
 *      schema, numeric `0.2` selects the current schema, anything else is a
 *      structured unsupported-version failure carrying the observed and
 *      supported versions.
 *
 * There is NO fallback or shape-sniffing between versions: a malformed
 * `0.2` lockfile fails as a `0.2` schema violation and is never
 * reinterpreted as legacy alpha `1`.
 */
export function parseLockfileDocument(bytes: Uint8Array | string): ParseLockfileResult {
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
    typeof jsonResult.data === 'object' && jsonResult.data !== null && 'lockfileVersion' in jsonResult.data
      ? (jsonResult.data as { lockfileVersion?: unknown }).lockfileVersion
      : undefined

  if (observedVersion === LEGACY_LOCKFILE_VERSION) {
    const validated = LegacyLockfileSchema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: {
          code: 'schema-violation',
          lockfileVersion: LEGACY_LOCKFILE_VERSION,
          errors: mapArkErrors(validated),
        },
      }
    }
    return { ok: true, data: { lockfileVersion: LEGACY_LOCKFILE_VERSION, lockfile: validated } }
  }

  if (observedVersion === CURRENT_LOCKFILE_VERSION) {
    const validated = CurrentLockfileSchema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: {
          code: 'schema-violation',
          lockfileVersion: CURRENT_LOCKFILE_VERSION,
          errors: mapArkErrors(validated),
        },
      }
    }
    return { ok: true, data: { lockfileVersion: CURRENT_LOCKFILE_VERSION, lockfile: validated } }
  }

  return {
    ok: false,
    failure: {
      code: 'unsupported-lockfile-version',
      observed: typeof observedVersion === 'number' ? observedVersion : undefined,
      supported: SUPPORTED_LOCKFILE_VERSIONS,
    },
  }
}
