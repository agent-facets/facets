import type { VersionSpec } from '@agent-facets/protocol'
import { FIRST_PARTY_ADAPTERS } from '../../adapters/first-party.ts'
import { parseVersionSpec } from '../facet/parse-version.ts'
import type { ParseError } from '../facet/types.ts'

/**
 * Parses an adapter install specifier into a resolved source type.
 *
 * Specifier formats:
 * - Built-in name: "opencode", "claude-code", "codex" (from the
 *   first-party catalog), optionally with a version selector
 * - npm package: "@scope/adapter-name" or "adapter-name", optionally
 *   with a version selector ("name@1.2.3", "@scope/name@1.*", "name@latest")
 * - Git URL: "git+https://...", "git+ssh://..."
 * - Local path: "./path", "../path", "/absolute/path"
 */

/**
 * Alias map for first-party adapter convenience names, derived from the
 * first-party catalog — the single source of truth for both picker
 * content and alias-to-package resolution.
 */
const BUILTIN_ALIASES: ReadonlyMap<string, string> = new Map(
  FIRST_PARTY_ADAPTERS.map((adapter) => [adapter.name, adapter.npmPackage]),
)

/**
 * The package-version request attached to an npm adapter source.
 * Non-overlapping variants preserve the user's intent:
 *
 *   - `implicit` — bare package name or first-party alias; resolution
 *     selects the highest compatible stable release.
 *   - `exact` — a fully pinned `M.N.P`; resolution considers only that
 *     release and never substitutes another.
 *   - `selector` — an explicit Facet-style wildcard or `latest`
 *     selector; resolution selects the highest compatible stable
 *     release satisfying it. The `spec` type excludes `exact` so a
 *     pinned version cannot masquerade as a selector.
 *
 * `raw` is the surface form the user typed, for display.
 */
export type NpmVersionRequest =
  | { kind: 'implicit' }
  | { kind: 'exact'; major: number; minor: number; patch: number; raw: string }
  | {
      kind: 'selector'
      spec: Extract<VersionSpec, { kind: 'majorWildcard' | 'minorWildcard' | 'wildcard' | 'latest' }>
      raw: string
    }

export type ResolvedAdapterSpecifier =
  | { type: 'npm'; packageName: string; request: NpmVersionRequest }
  | { type: 'git'; url: string; commitish?: string }
  | { type: 'local'; path: string }

/**
 * Discriminated result for `parseAdapterSpecifier`. The success arm
 * carries the resolved source description; the failure arms carry
 * structured fields the CLI needs to render a precise message.
 *
 *   - `invalid-git-url` — the specifier started with `git+` but the
 *     URL after the prefix used a scheme outside the allowlist
 *     (https/http/ssh/git/file). Closes the F15 tar-slip / flag-injection
 *     hole at the boundary.
 *   - `invalid-npm-selector` — the npm version selector after `@` is
 *     not in the supported exact/wildcard/`latest` grammar. Carries the
 *     structured `ParseError` from the shared Facet selector parser
 *     (caret/tilde/comparator/OR/hyphen/x-range/prerelease/empty).
 */
export type ParseAdapterSpecifierResult =
  | { ok: true; resolved: ResolvedAdapterSpecifier }
  | { ok: false; reason: 'invalid-git-url'; specifier: string; url: string }
  | {
      ok: false
      reason: 'invalid-npm-selector'
      specifier: string
      packageName: string
      selector: string
      error: ParseError
    }

// F15 — same scheme allowlist as the facet-side parseFacetSource. Anything
// not in this set (notably leading `-` or nonsense schemes) is rejected
// before the URL reaches `git clone`.
const GIT_URL_SCHEME_RE = /^(https?|ssh|git|file):\/\//

/**
 * Parse an adapter install specifier into a resolved source description.
 * Does NOT perform I/O — just classifies and normalizes the input string.
 *
 * Returns a discriminated `ParseAdapterSpecifierResult` — never throws.
 * Errors are values: callers pattern-match on `result.reason`.
 */
export function parseAdapterSpecifier(specifier: string): ParseAdapterSpecifierResult {
  // Git URLs: git+https://, git+ssh://
  if (specifier.startsWith('git+')) {
    const raw = specifier.slice(4) // strip "git+" prefix
    const hashIndex = raw.indexOf('#')
    const url = hashIndex === -1 ? raw : raw.slice(0, hashIndex)
    const commitish = hashIndex === -1 ? undefined : raw.slice(hashIndex + 1)
    if (!GIT_URL_SCHEME_RE.test(url)) {
      return { ok: false, reason: 'invalid-git-url', specifier, url }
    }
    return {
      ok: true,
      resolved: commitish !== undefined ? { type: 'git', url, commitish } : { type: 'git', url },
    }
  }

  // Local paths: ./, ../, /absolute
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
    return { ok: true, resolved: { type: 'local', path: specifier } }
  }

  // npm package (bare name, alias, or either with a version selector)
  const { name, selector } = splitNpmSpecifier(specifier)
  const packageName = BUILTIN_ALIASES.get(name) ?? name

  if (selector === undefined) {
    return { ok: true, resolved: { type: 'npm', packageName, request: { kind: 'implicit' } } }
  }

  const parsed = parseVersionSpec(selector)
  if (!parsed.ok) {
    return { ok: false, reason: 'invalid-npm-selector', specifier, packageName, selector, error: parsed.error }
  }
  const spec = parsed.value
  const request: NpmVersionRequest =
    spec.kind === 'exact'
      ? { kind: 'exact', major: spec.major, minor: spec.minor, patch: spec.patch, raw: selector }
      : { kind: 'selector', spec, raw: selector }
  return { ok: true, resolved: { type: 'npm', packageName, request } }
}

/**
 * Split an npm specifier into package name and optional version
 * selector. Scoped names keep their leading `@`: the version delimiter
 * is an `@` that appears after the package name — for `@scope/name`
 * forms, after the first `/`; otherwise any `@` past position 0.
 */
function splitNpmSpecifier(specifier: string): { name: string; selector?: string } {
  const searchFrom = specifier.startsWith('@') ? specifier.indexOf('/') + 1 : 1
  // A leading '@' with no '/' can't carry a selector delimiter we
  // recognize; treat the whole string as the package name.
  if (searchFrom === 0) return { name: specifier }
  const atIndex = specifier.indexOf('@', Math.max(searchFrom, 1))
  if (atIndex === -1) return { name: specifier }
  return { name: specifier.slice(0, atIndex), selector: specifier.slice(atIndex + 1) }
}

/** Returns the list of known built-in adapter names (from the first-party catalog). */
export function getBuiltinAdapterNames(): string[] {
  return [...BUILTIN_ALIASES.keys()]
}
