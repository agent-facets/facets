import {
  CURRENT_PROJECT_MANIFEST_VERSION,
  type FacetMaterializationOverrides,
  facetEntryOverrides,
  facetEntrySource,
  type LEGACY_PROJECT_MANIFEST_VERSION,
  MATERIALIZATION_OVERRIDE_GROUPS,
  type PROJECT_MANIFEST_VERSION_0_1,
  type ProjectAssetOverride,
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

/**
 * The exact schema a manifest's bytes validated under.
 *
 * Every readable version is a member, not just the one a normal write
 * emits: this records what was READ. Migration is the difference between
 * this value and {@link CURRENT_PROJECT_MANIFEST_VERSION}, so collapsing a
 * readable-but-superseded version into the current tag would erase the only
 * evidence that a document needs migrating — and would let frozen mode,
 * which must never migrate, believe it had already read current bytes.
 */
export type LoadedManifestVersion =
  | typeof LEGACY_PROJECT_MANIFEST_VERSION
  | typeof PROJECT_MANIFEST_VERSION_0_1
  | typeof CURRENT_PROJECT_MANIFEST_VERSION

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

  // Null-prototype, because a facet key is an arbitrary string from a
  // user-authored file. Assigning an own `__proto__` key into an ordinary
  // `{}` invokes the inherited setter instead of creating a property, so the
  // declaration silently vanished — and a vanished facet reads as REMOVED,
  // which would delete its locked assets and commit a manifest without it.
  // It now survives to ordinary facet-name validation, which rejects it as a
  // name mismatch. Reading such a key back is equally unsafe, which is what
  // {@link ownEntry} is for at the consuming sites.
  const facets: Record<string, NormalizedFacetEntry> = Object.create(null)
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

/** How many overrides an entry declares across every recognized group. */
export function countOverrides(overrides: FacetMaterializationOverrides | undefined): number {
  if (overrides === undefined) return 0
  return MATERIALIZATION_OVERRIDE_GROUPS.reduce((total, group) => total + Object.keys(overrides[group] ?? {}).length, 0)
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
  const existing = ownNode(facets, name)
  // Narrowed here rather than inferred from `countOverrides(...) !== 0`, so
  // the expanded branch below holds a value the type system agrees exists.
  const overrides = entry.overrides

  if (overrides === undefined || countOverrides(overrides) === 0) {
    // Canonical compact form. Skip the assignment when it is already correct
    // so a facet the operation did not touch keeps its comments verbatim.
    if (existing !== entry.source) {
      defineNode(facets, name, entry.source)
    }
    return
  }

  if (isPlainObject(existing)) {
    // Mutate the existing expanded entry so its own comments survive.
    const expanded = existing as { source?: unknown; materialization?: unknown }
    if (expanded.source !== entry.source) {
      expanded.source = entry.source
    }
    reconcileOverrides(expanded, overrides)
    return
  }

  defineNode(facets, name, { source: entry.source, materialization: overrides })
}

/**
 * Bring an expanded entry's `materialization` block in line with the desired
 * overrides, touching as little of the live document as possible.
 *
 * Reassigning the whole subtree was correct in every observable way except
 * one: comment-json keeps comment metadata on Symbol-keyed properties of the
 * object being replaced, so a note explaining WHY an asset was aliased died
 * on the next routine `facet install` — even when the intent had not changed
 * at all. Comparing by value rather than by identity is what makes the
 * unchanged case a true no-op: `finalizeMaterializationIntent` rebuilds the
 * desired override map on every run, so the two objects are never the same
 * object even when they say the same thing.
 *
 * Unrecognized keys inside the block are deliberately left alone; only the
 * groups the schema defines are reconciled.
 */
function reconcileOverrides(expanded: { materialization?: unknown }, desired: FacetMaterializationOverrides): void {
  if (!isPlainObject(expanded.materialization)) {
    expanded.materialization = desired
    return
  }
  const document = expanded.materialization as Record<string, unknown>

  for (const group of MATERIALIZATION_OVERRIDE_GROUPS) {
    const desiredGroup = desired[group]
    if (desiredGroup === undefined || Object.keys(desiredGroup).length === 0) {
      // The canonical form of "no overrides of this type" is an absent group,
      // not an empty object.
      if (Object.hasOwn(document, group)) delete document[group]
      continue
    }
    const existingGroup = document[group]
    if (!isPlainObject(existingGroup)) {
      document[group] = desiredGroup
      continue
    }
    const groupDocument = existingGroup as Record<string, unknown>
    for (const authoredName of Object.keys(groupDocument)) {
      // A dropped override takes its own comment with it, which is right:
      // the note described a decision that no longer exists.
      if (!Object.hasOwn(desiredGroup, authoredName)) delete groupDocument[authoredName]
    }
    for (const [authoredName, disposition] of Object.entries(desiredGroup)) {
      writeDisposition(groupDocument, authoredName, disposition)
    }
  }
}

/**
 * Write one override in place. An unchanged disposition is not written at
 * all; a changed one updates only the fields that differ, so a comment
 * attached to the override survives an alias being retargeted.
 */
function writeDisposition(
  groupDocument: Record<string, unknown>,
  authoredName: string,
  desired: ProjectAssetOverride,
): void {
  const current = ownNode(groupDocument, authoredName)
  if (!isPlainObject(current)) {
    defineNode(groupDocument, authoredName, desired)
    return
  }
  const document = current as Record<string, unknown>
  if (document.kind === desired.kind) {
    if (desired.kind === 'aliased') {
      if (document.as !== desired.as) document.as = desired.as
      return
    }
    // An `omitted` arm carries no effective name; a stray one would be
    // rejected by the schema on the next read.
    if (Object.hasOwn(document, 'as')) delete document.as
    return
  }
  document.kind = desired.kind
  if (desired.kind === 'aliased') document.as = desired.as
  else if (Object.hasOwn(document, 'as')) delete document.as
}

/** A live comment-json object node, as opposed to an array or a primitive. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Own-property read of a live document node. The node cannot be swapped for a
 * null-prototype copy — comment-json hangs comment metadata off it — so the
 * guard goes on the access. Without it a `__proto__` key reads back as
 * `Object.prototype`, which {@link isPlainObject} accepts, and the update-in-
 * place branch then writes onto the prototype.
 */
function ownNode(node: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(node, key) ? node[key] : undefined
}

/**
 * Own-property write into a live document node. Assignment for `__proto__`
 * invokes the inherited setter and creates no own key, so the facet or
 * override vanishes from the serialized document while its assets stay on
 * disk. The descriptor matches what an assignment would have produced.
 */
function defineNode(node: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(node, key, { value, enumerable: true, writable: true, configurable: true })
}
