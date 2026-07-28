import type { ValidationError } from '@agent-facets/common'
import { type } from 'arktype'
import {
  LEGACY_LOCKFILE_VERSION,
  type LegacyLockfile,
  LegacyLockfileSchema,
  LOCKFILE_VERSION_0_2,
  LOCKFILE_VERSION_0_3,
  type Lockfile02,
  Lockfile02Schema,
  type Lockfile03,
  Lockfile03Schema,
  SUPPORTED_LOCKFILE_VERSIONS,
} from '../schemas/lockfile.ts'
import type { MaterializationDisposition } from '../schemas/materialization.ts'
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
  | { lockfileVersion: typeof LOCKFILE_VERSION_0_2; lockfile: Lockfile02 }
  | { lockfileVersion: typeof LOCKFILE_VERSION_0_3; lockfile: Lockfile03 }

/**
 * The exact set of lockfile versions this implementation can READ. Derived
 * from {@link ParsedLockfile} rather than restated, so a new reader cannot
 * be added without the tag set following it.
 */
export type SupportedLockfileVersion = ParsedLockfile['lockfileVersion']

/**
 * Any lockfile document this implementation accepts.
 *
 * Deliberately a projection of {@link ParsedLockfile}, not a hand-written
 * permissive shape: a type with an unpinned numeric version and
 * lowest-common-denominator assets would admit documents whose declared
 * version and asset shape disagree — a `0.3` version carrying identity-only
 * assets, say — which no reader would ever produce. Consumers that need
 * `files` or `materialization` must discriminate on the version tag from
 * {@link ParsedLockfile} rather than probing the shape.
 */
export type SupportedLockfile = ParsedLockfile['lockfile']

/** Any facet entry inside a supported lockfile, across every read version. */
export type SupportedLockfileFacet = SupportedLockfile['facets'][string]

/** Any asset entry inside a supported lockfile, across every read version. */
export type SupportedLockfileAssetEntry = SupportedLockfileFacet['assets'][number]

export type ParseLockfileResult = { ok: true; data: ParsedLockfile } | { ok: false; failure: LockfileParseFailure }

/**
 * Parses and validates a `facets.lock` document with exact version dispatch
 * (design D10):
 *
 *   1. JSON parse (syntax errors are structured failures).
 *   2. Reject duplicate object member names before schema validation.
 *   3. Dispatch on `lockfileVersion` by EXACT equality, never numeric
 *      ordering — numeric `1` selects only the legacy alpha schema, `0.2`
 *      selects only the `0.2` schema, `0.3` selects only the `0.3` schema,
 *      and anything else is a structured unsupported-version failure
 *      carrying the observed and supported versions.
 *
 * Exact equality matters more here than anywhere else in the codebase:
 * `0.3 < 0.2 < 1` numerically, so any ordered comparison would rank the
 * newest schema as the oldest.
 *
 * There is NO fallback or shape-sniffing between versions: a malformed
 * `0.3` lockfile fails as a `0.3` schema violation and is never
 * reinterpreted as `0.2` or as legacy alpha `1`.
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

  if (observedVersion === LOCKFILE_VERSION_0_2) {
    const validated = Lockfile02Schema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: {
          code: 'schema-violation',
          lockfileVersion: LOCKFILE_VERSION_0_2,
          errors: mapArkErrors(validated),
        },
      }
    }
    return { ok: true, data: { lockfileVersion: LOCKFILE_VERSION_0_2, lockfile: validated } }
  }

  if (observedVersion === LOCKFILE_VERSION_0_3) {
    const validated = Lockfile03Schema(jsonResult.data)
    if (validated instanceof type.errors) {
      return {
        ok: false,
        failure: {
          code: 'schema-violation',
          lockfileVersion: LOCKFILE_VERSION_0_3,
          errors: mapArkErrors(validated),
        },
      }
    }
    return { ok: true, data: { lockfileVersion: LOCKFILE_VERSION_0_3, lockfile: validated } }
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

/**
 * The materialization disposition a locked asset records.
 *
 * Only a `0.3` entry carries one. Versions predating dispositions could
 * only ever have meant authored materialization, so they refine to an
 * explicit `authored` rather than to "unknown" — which is what lets a
 * project on an older lockfile compare equal to one that records the
 * default, instead of reporting drift on every asset.
 *
 * Published here rather than restated per consumer: outcome
 * classification, frozen drift detection, and receipt construction each
 * need this refinement, and three copies of it would drift the day a
 * later version makes the field optional again.
 */
export function lockedDispositionOf(asset: SupportedLockfileAssetEntry): MaterializationDisposition {
  return 'materialization' in asset ? asset.materialization : { kind: 'authored' }
}
