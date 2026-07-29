import type { ValidationError } from '@agent-facets/common'
import { type } from 'arktype'
import {
  type CurrentLockfile,
  type CurrentLockfileAssetEntry,
  type CurrentLockfileFacet,
  LOCKFILE_VERSION_0_2,
  LOCKFILE_VERSION_0_3,
  type Lockfile02,
  Lockfile02Schema,
  type Lockfile03,
  Lockfile03Schema,
  type LockfileFileRecord,
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
 * downstream consumers dispatch exhaustively — a disposition-less `0.2`
 * entry can never be mistaken for a `0.3` one.
 */
export type ParsedLockfile =
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
 *      ordering — `0.2` selects only the `0.2` schema, `0.3` selects only
 *      the `0.3` schema, and anything else is a structured
 *      unsupported-version failure carrying the observed and supported
 *      versions.
 *
 * A version number names a schema, not a position in a sequence, which is
 * why equality is the only correct comparison: `0.2` and `0.3` are labels
 * that happen to look ordered, and the withdrawn `1` sorts above both
 * despite naming the OLDEST shape.
 *
 * Numeric `1` is deliberately unsupported (see `schemas/lockfile.ts`): it
 * falls through to the unsupported-version failure rather than parsing, so
 * a withdrawn alpha document is never resurrected by shape.
 *
 * There is NO fallback or shape-sniffing between versions: a malformed
 * `0.3` lockfile fails as a `0.3` schema violation and is never
 * reinterpreted as `0.2`.
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
 * Only a `0.3` entry carries one. A `0.2` entry predates dispositions and
 * could only ever have meant authored materialization, so it refines to an
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

/**
 * Carry a loaded lockfile's unrecognized fields into the document that
 * replaces it.
 *
 * The published contract has always said unrecognized fields are preserved,
 * but only LOADING honored it: a producer rebuilds entries from resolved
 * state, so every rewrite — including the mandatory `0.2 → 0.3` migration —
 * silently dropped whatever it did not know about. This restores the promise
 * at every level the schema defines a shape for:
 *
 *   - the document itself;
 *   - each facet entry still present, matched by name;
 *   - a retained entry's `source`, but ONLY when the source kind is
 *     unchanged — a facet that moved from git to registry has a genuinely
 *     different provenance value, and carrying the old kind's extras into it
 *     would describe an origin that no longer exists;
 *   - each asset matched by authored `(scope, type, name)` — the identity
 *     aliasing deliberately does not move;
 *   - each file record matched by `path`.
 *
 * Two rules fall out of doing it this way. A schema-defined field always
 * wins a name collision, because only keys absent from the new value are
 * copied — so a future version claiming a name cannot be shadowed by stale
 * data carrying it. And extensions on a facet, asset, or file record the new
 * state no longer contains are dropped with it, because there is no
 * surviving value to attach them to.
 *
 * Non-mutating, but not deep-copying. Neither argument is mutated, and no
 * canonical value is ever read out of `previous` — a schema-defined field
 * always comes from `next`. The unrecognized values carried forward are
 * installed by reference rather than cloned, and a caller that builds `next`
 * out of `previous` (a removal-only refinement, say) hands over shared
 * structure of its own. Callers MUST therefore treat the result as read-only
 * and MUST NOT mutate either document afterwards; every caller today
 * serializes it immediately. Cloning here would not buy the stronger
 * guarantee anyway — it would have to clone `next` as well, which is not
 * this function's job.
 */
export function preserveLockfileExtensions(previous: SupportedLockfile, next: CurrentLockfile): CurrentLockfile {
  const facets: Record<string, CurrentLockfileFacet> = {}
  for (const [name, entry] of Object.entries(next.facets)) {
    const previousEntry = ownValue(previous.facets, name)
    // Defined rather than assigned, for the same reason the extension keys
    // below are: a facet literally named `__proto__` is a legal key of a
    // `Record<string, …>` and survives `JSON.parse`. Assigning it would
    // replace this map's prototype and create no own key — so the function
    // whose entire job is preservation would drop the facet it was given.
    defineOwn(facets, name, previousEntry === undefined ? entry : mergeFacetEntry(previousEntry, entry))
  }
  return withExtensions(previous, { ...next, facets })
}

function mergeFacetEntry(previous: SupportedLockfileFacet, next: CurrentLockfileFacet): CurrentLockfileFacet {
  const source = previous.source.kind === next.source.kind ? withExtensions(previous.source, next.source) : next.source
  const assets = next.assets.map((asset) => {
    const previousAsset = previous.assets.find(
      (candidate) => candidate.scope === asset.scope && candidate.type === asset.type && candidate.name === asset.name,
    )
    return previousAsset === undefined ? asset : mergeAssetEntry(previousAsset, asset)
  })
  return withExtensions(previous, { ...next, source, assets })
}

function mergeAssetEntry(
  previous: SupportedLockfileAssetEntry,
  next: CurrentLockfileAssetEntry,
): CurrentLockfileAssetEntry {
  const files = next.files.map((record) => {
    const previousRecord = previous.files.find((candidate) => candidate.path === record.path)
    return previousRecord === undefined ? record : withExtensions<LockfileFileRecord>(previousRecord, record)
  })
  return withExtensions(previous, { ...next, files })
}

/**
 * `next`, plus every own key of `previous` that `next` does not already
 * define. Copying only the absent keys is what makes "schema-defined fields
 * win" true by construction rather than by ordering a spread correctly.
 *
 * Keys are installed with {@link defineOwn} rather than assignment so an
 * extension literally named `__proto__` becomes an own property instead of
 * invoking the prototype setter and vanishing.
 */
function withExtensions<T extends object>(previous: unknown, next: T): T {
  if (typeof previous !== 'object' || previous === null || Array.isArray(previous)) return next
  const merged: Record<string, unknown> = { ...(next as Record<string, unknown>) }
  for (const [key, value] of Object.entries(previous)) {
    if (Object.hasOwn(merged, key)) continue
    defineOwn(merged, key, value)
  }
  return merged as T
}

/**
 * Install `key` as an own data property, whatever it is named.
 *
 * The write-side twin of {@link ownValue}: assignment consults the prototype
 * chain for a setter, and `Object.prototype.__proto__` is exactly that. The
 * descriptor matches what a plain assignment would have produced.
 */
function defineOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true })
}

/**
 * Own-property read of a facet map. Facet names are unconstrained strings,
 * so a plain indexed read of `constructor` would return an inherited
 * function rather than the absent entry the type promises.
 */
function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}
