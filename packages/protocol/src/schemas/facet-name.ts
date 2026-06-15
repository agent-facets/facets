/**
 * Facet identity grammar — the canonical rules for what a facet is called.
 *
 * The grammar is layered around one atomic unit, the **slug**:
 *
 *  - A slug is a single lowercase-kebab segment that is 2-64 characters long.
 *    It starts with a lowercase ASCII letter, ends with a lowercase ASCII
 *    letter or digit, contains only lowercase ASCII letters, ASCII digits,
 *    and hyphens in between, and never contains consecutive hyphens.
 *  - A username is a slug. A scope is a slug. A global (unscoped) facet name
 *    is a slug. The base name of a scoped facet is a slug. They are all the
 *    same constraint — `parseSlug` is the single source of truth, and it
 *    encodes the registry's canonical naming grammar so callers never need a
 *    separate stricter validator.
 *
 * A **facet name** is built from slugs. It is either:
 *
 *  - **unscoped**: a single slug (`cowsay`), or
 *  - **scoped**: `@<scope>/<name>` where both `scope` and `name` are slugs
 *    (`@julian/cowsay`).
 *
 * `parseSlug` is exported on its own so other facet-spec implementations
 * (notably the registry, which enforces scope ownership) validate scopes with
 * the exact same grammar instead of duplicating it.
 *
 * Input is validated, never normalized: uppercase letters and non-ASCII
 * characters are rejected rather than down-cased or transliterated. Both
 * parsers return discriminated-union results rather than throwing, so callers
 * handle malformed identities as data.
 */

/** Minimum length of a slug component (inclusive). */
const SLUG_MIN_LENGTH = 2
/** Maximum length of a slug component (inclusive). */
const SLUG_MAX_LENGTH = 64

/**
 * The canonical slug grammar: starts with a lowercase ASCII letter, ends with
 * a lowercase ASCII letter or digit, contains only lowercase ASCII letters,
 * digits, and hyphens in between, and rejects consecutive hyphens via the
 * `-(?!-+)` negative lookahead. The grammar alone requires at least 2
 * characters (a first and a final position); explicit length checks in
 * `parseSlug` still run first so callers get clearer error messages.
 */
const SLUG_RE = /^[a-z]([a-z0-9]|-(?!-+))*[a-z0-9]$/

/** Result of validating a single slug. Errors are data, not exceptions. */
export type SlugResult = { ok: true; value: string } | { ok: false; reason: string }

/**
 * Validate a single slug — the atomic facet-identity grammar shared by
 * usernames, scopes, global facet names, bare facet names, and the base name
 * of a scoped facet. This is the single source of truth for the canonical
 * naming grammar; it is intentionally case-sensitive and ASCII-only.
 *
 * The checks run from most specific to most general so the returned reason is
 * actionable for registry and CLI callers.
 */
export function parseSlug(value: string): SlugResult {
  if (value === '') {
    return { ok: false, reason: 'must not be empty' }
  }
  if (value.length < SLUG_MIN_LENGTH) {
    return { ok: false, reason: `must be at least ${SLUG_MIN_LENGTH} characters` }
  }
  if (value.length > SLUG_MAX_LENGTH) {
    return { ok: false, reason: `must be at most ${SLUG_MAX_LENGTH} characters` }
  }
  if (!/^[a-z]/.test(value)) {
    return { ok: false, reason: 'must start with a lowercase ASCII letter' }
  }
  if (!/[a-z0-9]$/.test(value)) {
    return { ok: false, reason: 'must end with a lowercase ASCII letter or digit' }
  }
  if (value.includes('--')) {
    return { ok: false, reason: 'must not contain consecutive hyphens' }
  }
  if (!SLUG_RE.test(value)) {
    return { ok: false, reason: 'must contain only lowercase ASCII letters, digits, and hyphens' }
  }
  return { ok: true, value }
}

/**
 * A parsed facet identity.
 *
 * `unscoped` carries the bare slug; `scoped` carries the scope slug and the
 * base name slug separately. The canonical string form is recovered from
 * `FacetNameResult.canonical` so callers never re-assemble `@scope/name` by
 * hand.
 */
export type FacetName = { kind: 'unscoped'; name: string } | { kind: 'scoped'; scope: string; name: string }

/** Result of parsing a full facet identity. Errors are data, not exceptions. */
export type FacetNameResult = { ok: true; value: FacetName; canonical: string } | { ok: false; reason: string }

/**
 * Parse a full facet identity: an unscoped slug (`cowsay`) or a scoped name
 * (`@scope/name`). Both forms are validated slug-by-slug via `parseSlug`, so
 * every component obeys the same canonical grammar — there is no second,
 * looser grammar for facet names.
 *
 * The leading `@` marks a scoped name; for a scoped name there SHALL be
 * exactly one `/` separating the scope slug from the base name slug. Extra
 * path depth (`@scope/name/extra`), a missing slash (`@scope`), and empty
 * segments (`@scope/`, `@/name`) are all rejected. Legacy `scope/name`
 * (without the leading `@`) is not a scoped form: it is treated as an
 * unscoped slug and rejected because a slug may not contain `/`.
 */
export function parseFacetName(value: string): FacetNameResult {
  if (value === '') {
    return { ok: false, reason: 'facet name must not be empty' }
  }

  if (value.startsWith('@')) {
    const rest = value.slice(1)
    const slashIndex = rest.indexOf('/')
    if (slashIndex === -1) {
      return { ok: false, reason: 'scoped facet name must be of the form "@scope/name"' }
    }
    if (rest.indexOf('/', slashIndex + 1) !== -1) {
      return { ok: false, reason: 'scoped facet name must contain exactly one "/" separating scope and name' }
    }
    const scopePart = rest.slice(0, slashIndex)
    const namePart = rest.slice(slashIndex + 1)

    const scope = parseSlug(scopePart)
    if (!scope.ok) {
      return { ok: false, reason: `scope "${scopePart}" ${scope.reason}` }
    }
    const name = parseSlug(namePart)
    if (!name.ok) {
      return { ok: false, reason: `facet name "${namePart}" ${name.reason}` }
    }

    return {
      ok: true,
      value: { kind: 'scoped', scope: scope.value, name: name.value },
      canonical: `@${scope.value}/${name.value}`,
    }
  }

  const name = parseSlug(value)
  if (!name.ok) {
    return { ok: false, reason: `facet name "${value}" ${name.reason}` }
  }
  return { ok: true, value: { kind: 'unscoped', name: name.value }, canonical: name.value }
}

/**
 * Thin boolean-style wrapper over `parseFacetName` for schema `.narrow()`
 * call sites that only need pass/fail + a reason. Mirrors the shape of
 * `validateAssetName` from `@agent-facets/common` so the two compose
 * identically into `ctx.mustBe(...)`.
 */
export function validateFacetName(value: string): { ok: true } | { ok: false; reason: string } {
  const result = parseFacetName(value)
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}
