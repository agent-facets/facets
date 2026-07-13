/**
 * Asset-name grammar — the canonical rules for what a skill, command, or
 * agent is called. Distinct from the facet *identity* grammar (`parseSlug` in
 * `facet-name.ts`): asset names are local, never scoped with `@`, and follow
 * the Agent Skills specification name field exactly:
 * https://agentskills.io/specification#name-field
 *
 * An asset name is one or more `/`-separated **segments**. A single segment
 * is the atomic unit and obeys the Agent Skills grammar:
 *
 *  - 1-64 characters
 *  - lowercase ASCII letters, ASCII digits, and hyphens only (`a-z`, `0-9`, `-`)
 *  - must not start or end with a hyphen (`-`)
 *  - must not contain consecutive hyphens (`--`)
 *
 * Deliberate divergences from `parseSlug` (the facet identity grammar):
 *  - **min length 1**, not 2 — Agent Skills allows single-char names (`a`).
 *  - **digit-start is allowed** — `2fa` is a valid asset name; a facet slug
 *    must start with a letter.
 *
 * Multi-segment names (`viper-plans/planning`) are permitted for facet
 * namespacing: assets contributed by an included facet land under a
 * `<namespace>/<name>` path. Every segment is validated independently, so
 * empty segments, `.`/`..` segments, and backslashes are all rejected — the
 * grammar subsumes the path-safety guard (`@agent-facets/common`'s
 * `validateAssetName`) for manifest keys. Authoring surfaces (create, modify,
 * the wizard) validate a **single** segment only via
 * `parseAssetNameSegment` / `validateAssetNameSegment`.
 *
 * Input is validated, never normalized: uppercase letters and non-ASCII
 * characters are rejected rather than down-cased or transliterated. Both
 * parsers return discriminated-union results rather than throwing, so callers
 * handle malformed names as data.
 */

/** Minimum length of a single asset-name segment (inclusive). */
const SEGMENT_MIN_LENGTH = 1
/** Maximum length of a single asset-name segment (inclusive). */
const SEGMENT_MAX_LENGTH = 64

/**
 * The canonical asset-name segment grammar: a single character that is a
 * lowercase ASCII letter or digit, OR a run that starts and ends with a
 * lowercase ASCII letter or digit with letters, digits, and non-consecutive
 * hyphens in between. The `-(?!-+)` negative lookahead rejects consecutive
 * hyphens. Length is checked explicitly in `parseAssetNameSegment` so callers
 * get a clearer error than a bare pattern mismatch.
 */
const SEGMENT_RE = /^[a-z0-9]$|^[a-z0-9]([a-z0-9]|-(?!-+))*[a-z0-9]$/

/** Result of validating a single asset-name segment. Errors are data, not exceptions. */
export type AssetNameSegmentResult = { ok: true; value: string } | { ok: false; reason: string }

/**
 * Validate a single asset-name segment against the Agent Skills grammar. This
 * is the atomic unit shared by skill, command, and agent names. It is
 * intentionally case-sensitive and ASCII-only.
 *
 * The checks run from most specific to most general so the returned reason is
 * actionable for build, CLI, and edit callers.
 */
export function parseAssetNameSegment(value: string): AssetNameSegmentResult {
  if (value === '') {
    return { ok: false, reason: 'must not be empty' }
  }
  if (value.length < SEGMENT_MIN_LENGTH) {
    return { ok: false, reason: `must be at least ${SEGMENT_MIN_LENGTH} character` }
  }
  if (value.length > SEGMENT_MAX_LENGTH) {
    return { ok: false, reason: `must be at most ${SEGMENT_MAX_LENGTH} characters` }
  }
  if (value.startsWith('-')) {
    return { ok: false, reason: 'must not start with a hyphen' }
  }
  if (value.endsWith('-')) {
    return { ok: false, reason: 'must not end with a hyphen' }
  }
  if (value.includes('--')) {
    return { ok: false, reason: 'must not contain consecutive hyphens' }
  }
  if (!SEGMENT_RE.test(value)) {
    return { ok: false, reason: 'must contain only lowercase ASCII letters, digits, and hyphens' }
  }
  return { ok: true, value }
}

/** Result of validating a full (possibly namespaced) asset name. Errors are data, not exceptions. */
export type AssetNameResult = { ok: true; value: string } | { ok: false; reason: string }

/**
 * Parse a full asset name: one or more `/`-separated segments, each obeying
 * the Agent Skills grammar via `parseAssetNameSegment`. A namespaced name
 * (`viper-plans/planning`) is valid iff every segment is valid; there is no
 * looser grammar for the segments of a multi-segment name.
 *
 * An empty name, a leading/trailing slash (which produces an empty segment),
 * and consecutive slashes (`a//b`) are all rejected because they yield an
 * empty segment. When a multi-segment name has an invalid segment, the reason
 * names the offending segment so callers can point at it.
 */
export function parseAssetName(value: string): AssetNameResult {
  if (value === '') {
    return { ok: false, reason: 'must not be empty' }
  }
  const segments = value.split('/')
  const multi = segments.length > 1
  for (const segment of segments) {
    const result = parseAssetNameSegment(segment)
    if (!result.ok) {
      return {
        ok: false,
        reason: multi ? `segment "${segment}" ${result.reason}` : result.reason,
      }
    }
  }
  return { ok: true, value }
}

/**
 * Thin boolean-style wrapper over `parseAssetName` for arktype `.narrow()`
 * call sites and CLI/engine call sites that only need pass/fail + a reason.
 * Mirrors the shape of `validateFacetName` so the two compose identically
 * into `ctx.mustBe(...)`. Validates the full (possibly namespaced) name.
 */
export function validateAssetName(value: string): { ok: true } | { ok: false; reason: string } {
  const result = parseAssetName(value)
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}

/**
 * Thin boolean-style wrapper over `parseAssetNameSegment` for authoring
 * surfaces (create, modify, the wizard) that accept a single segment only —
 * namespacing is a build/install-time concern, not something a user types
 * when scaffolding one asset.
 */
export function validateAssetNameSegment(value: string): { ok: true } | { ok: false; reason: string } {
  const result = parseAssetNameSegment(value)
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}
