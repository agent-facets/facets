/**
 * Facet identity grammar — the canonical rules for what a facet is called.
 *
 * The grammar is layered around one atomic unit, the **slug**:
 *
 *  - A slug is a single lowercase-kebab segment: it starts with a lowercase
 *    letter, contains only lowercase letters, digits, and hyphens after the
 *    first character, and ends with a lowercase letter or digit.
 *  - A username is a slug. A scope is a slug. A global (unscoped) facet name
 *    is a slug. The base name of a scoped facet is a slug. They are all the
 *    same constraint — `parseSlug` is the single source of truth.
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
 * Both parsers return discriminated-union results rather than throwing, so
 * callers handle malformed identities as data.
 */

/**
 * A single kebab-case identity segment: lowercase letter start, lowercase /
 * digit / hyphen interior, alphanumeric end. No uppercase, no underscores, no
 * leading/trailing hyphen, no slashes, no `@`, no `.`/`..` traversal, no
 * whitespace. Single-character names (`a`) are permitted.
 */
const SLUG_RE = /^[a-z]([a-z0-9-]*[a-z0-9])?$/

const SLUG_RULE =
  'a lowercase kebab-case slug (lowercase letter start; lowercase letters, digits, and hyphens after; alphanumeric end)'

/** Result of validating a single slug. Errors are data, not exceptions. */
export type SlugResult = { ok: true; value: string } | { ok: false; reason: string }

/**
 * Validate a single slug — the atomic facet-identity grammar shared by
 * usernames, scopes, global facet names, bare facet names, and the base name
 * of a scoped facet.
 */
export function parseSlug(value: string): SlugResult {
  if (value === '') {
    return { ok: false, reason: 'must not be empty' }
  }
  if (!SLUG_RE.test(value)) {
    return { ok: false, reason: `must be ${SLUG_RULE}` }
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
 * (`@scope/name`). Both forms are validated slug-by-slug via `parseSlug`.
 *
 * The leading `@` marks a scoped name; for a scoped name there SHALL be
 * exactly one `/` separating the scope slug from the base name slug. Extra
 * path depth (`@scope/name/extra`), a missing slash (`@scope`), and empty
 * segments (`@scope/`, `@/name`) are all rejected.
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
