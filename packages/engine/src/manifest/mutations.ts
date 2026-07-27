import {
  CURRENT_PROJECT_MANIFEST_VERSION,
  type FacetMaterializationOverrides,
  facetEntryOverrides,
  facetEntrySource,
  type LEGACY_PROJECT_MANIFEST_VERSION,
  type ProjectManifestParseFailure,
  parseProjectManifestDocument,
} from '@agent-facets/protocol'
import { parse as parseCommentJson, stringify as stringifyCommentJson } from 'comment-json'

export const FACETS_JSON_FILE = 'facets.json'

/**
 * Pure manifest handling for facets.json.
 *
 * Engine owns all JSON reading/writing logic (Adjustment M). CLI is
 * presentation + OS I/O only and never imports comment-json or touches the
 * parsed shape.
 *
 * Two representations exist side by side, deliberately:
 *
 *   - **The normalized view** ({@link NormalizedProjectManifest.facets}) is
 *     what the install pipeline reasons about: one uniform entry shape
 *     regardless of whether the document spelled it compact or expanded, and
 *     regardless of format version.
 *   - **The document** ({@link ManifestDocument}) is the live comment-json
 *     value. It is the only thing ever serialized, and it is mutated IN
 *     PLACE — never rebuilt — because comment-json stores comment metadata
 *     on non-enumerable Symbol-keyed properties that object spread silently
 *     drops. Direct key assignment and deletion preserve them; `{ ...doc }`
 *     does not.
 *
 * The protocol package owns the schema. Engine never re-implements version
 * dispatch or entry validation; it delegates to `parseProjectManifestDocument`
 * and normalizes the validated result.
 */

/** The normalized form of one facet entry, whichever form declared it. */
export interface NormalizedFacetEntry {
  /** The source specifier as written. */
  source: string
  /** Materialization overrides, or undefined when the facet declares none. */
  overrides: FacetMaterializationOverrides | undefined
}

/** The exact schema a manifest's bytes validated under. */
export type LoadedManifestVersion = typeof LEGACY_PROJECT_MANIFEST_VERSION | typeof CURRENT_PROJECT_MANIFEST_VERSION

/**
 * The live comment-json document. Structurally typed rather than imported
 * from comment-json because the comment metadata rides on symbols the type
 * system cannot see — which is precisely why this value must be mutated
 * rather than reconstructed.
 */
export interface ManifestDocument {
  manifestVersion?: number
  facets: Record<string, unknown>
}

export interface NormalizedProjectManifest {
  /**
   * Which schema the bytes validated under. Drives migration policy: a
   * successful non-frozen write always emits the current version, but frozen
   * mode must retain whatever was loaded.
   */
  loadedVersion: LoadedManifestVersion
  /** Every declared facet in one uniform shape. */
  facets: Record<string, NormalizedFacetEntry>
  /** The writable, comment-preserving document. */
  document: ManifestDocument
}

export type ParseProjectManifestResult =
  | { ok: true; manifest: NormalizedProjectManifest }
  | { ok: false; failure: ProjectManifestParseFailure }

/**
 * Replace every `//` and block-comment span with spaces, preserving all other
 * bytes and every offset.
 *
 * This exists because the two requirements on this file pull in opposite
 * directions. Comments must survive a round trip, so the document is parsed
 * with a comment-tolerant parser. But validation, exact version dispatch, and
 * duplicate-member rejection belong to protocol's loader, which uses
 * `JSON.parse` and would reject a commented document outright.
 *
 * Stripping to spaces rather than deleting is what makes this safe: the
 * member structure is byte-for-byte preserved, so a duplicate member survives
 * into the stripped text and protocol's scanner still catches it. Removing
 * the spans, or round-tripping through a parser, would collapse duplicates
 * through last-member-wins and defeat that check.
 */
export function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  let inString = false

  while (i < text.length) {
    const ch = text[i] as string

    if (inString) {
      out += ch
      if (ch === '\\') {
        // Copy the escaped character verbatim so an escaped quote does not
        // look like the end of the string.
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }

    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      while (i < stop) {
        // Newlines are kept so reported line numbers stay accurate.
        out += text[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }

    out += ch
    i++
  }

  return out
}

/**
 * Parse and validate facets.json bytes into a normalized manifest.
 *
 * Validation, exact `manifestVersion` dispatch, and duplicate-member
 * rejection are delegated to protocol. The comment-preserving document is
 * parsed separately from the same bytes and carried on the result so a later
 * write can mutate it in place.
 */
export function parseProjectManifest(raw: string): ParseProjectManifestResult {
  const validated = parseProjectManifestDocument(stripJsonComments(raw))
  if (!validated.ok) {
    return { ok: false, failure: validated.failure }
  }

  // Protocol already accepted these bytes, so the comment-tolerant parser
  // cannot fail on them — it accepts a strict superset of JSON. The guard is
  // defense in depth at a trust boundary, converted to a value rather than
  // allowed to escape as a throw.
  let document: ManifestDocument
  try {
    document = parseCommentJson(raw) as unknown as ManifestDocument
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown JSON parse error'
    return {
      ok: false,
      failure: {
        code: 'invalid-json',
        errors: [
          {
            path: '',
            message: `${FACETS_JSON_FILE} syntax error: ${message}`,
            expected: 'valid JSON',
            actual: 'malformed JSON',
          },
        ],
      },
    }
  }

  const facets: Record<string, NormalizedFacetEntry> = {}
  for (const [name, entry] of Object.entries(validated.data.manifest.facets)) {
    facets[name] = { source: facetEntrySource(entry), overrides: facetEntryOverrides(entry) }
  }

  return {
    ok: true,
    manifest: { loadedVersion: validated.data.manifestVersion, facets, document },
  }
}

/**
 * Serialize a manifest document, preserving its comment metadata. Uses
 * 2-space indentation to match ADR-006.
 *
 * Deliberately does NOT go through engine's `jsonFileText` helper: it must
 * serialize via comment-json to preserve comments, so it upholds the same
 * invariant (2-space indent, trailing newline) independently.
 */
export function serializeProjectManifest(document: ManifestDocument): string {
  return `${stringifyCommentJson(document, null, 2)}\n`
}

/**
 * An empty manifest at the current format version. Used when `facet add`
 * runs against a directory with no existing facets.json — a manifest this
 * system creates is never legacy.
 */
export function emptyProjectManifest(): NormalizedProjectManifest {
  return {
    loadedVersion: CURRENT_PROJECT_MANIFEST_VERSION,
    facets: {},
    document: { manifestVersion: CURRENT_PROJECT_MANIFEST_VERSION, facets: {} },
  }
}

/** How many overrides an entry declares across every asset type. */
export function countOverrides(overrides: FacetMaterializationOverrides | undefined): number {
  if (overrides === undefined) return 0
  return (
    Object.keys(overrides.skills ?? {}).length +
    Object.keys(overrides.agents ?? {}).length +
    Object.keys(overrides.commands ?? {}).length
  )
}

/**
 * Apply the desired facet set to the document, IN PLACE.
 *
 * Every mutation is a direct key assignment or deletion so comment metadata
 * on untouched keys survives. An entry whose normalized value is unchanged is
 * not reassigned at all, which additionally preserves the exact spelling and
 * inner comments of expanded entries the operation did not touch.
 *
 * Canonical form: a facet with no overrides is written as its compact source
 * string. An expanded entry whose final override was pruned therefore
 * collapses back to a string rather than lingering as an empty object.
 *
 * The document is stamped with the current `manifestVersion`. On a legacy
 * document the field is absent, so assignment appends it after `facets` —
 * valid JSON that re-parses identically, and cheaper than rebuilding the
 * object and hand-copying every comment symbol across.
 */
export function applyDesiredFacets(
  document: ManifestDocument,
  desired: Readonly<Record<string, NormalizedFacetEntry>>,
): void {
  document.manifestVersion = CURRENT_PROJECT_MANIFEST_VERSION

  for (const name of Object.keys(document.facets)) {
    if (!Object.hasOwn(desired, name)) {
      delete document.facets[name]
    }
  }

  for (const [name, entry] of Object.entries(desired)) {
    writeEntry(document.facets, name, entry)
  }
}

/** Write one entry in canonical form, touching the document as little as possible. */
function writeEntry(facets: Record<string, unknown>, name: string, entry: NormalizedFacetEntry): void {
  const existing = facets[name]

  if (countOverrides(entry.overrides) === 0) {
    // Canonical compact form. Skip the assignment when it is already correct
    // so a facet the operation did not touch keeps its comments verbatim.
    if (existing !== entry.source) {
      facets[name] = entry.source
    }
    return
  }

  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    // Mutate the existing expanded entry so its own comments survive.
    const expanded = existing as { source?: unknown; materialization?: unknown }
    if (expanded.source !== entry.source) {
      expanded.source = entry.source
    }
    expanded.materialization = entry.overrides
    return
  }

  facets[name] = { source: entry.source, materialization: entry.overrides }
}
