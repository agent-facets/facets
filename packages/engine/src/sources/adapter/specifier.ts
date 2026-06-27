/**
 * Parses an adapter install specifier into a resolved source type.
 *
 * Specifier formats:
 * - Built-in name: "opencode", "claude-code", "codex", "openclaw"
 * - npm package: "@scope/adapter-name" or "adapter-name"
 * - Git URL: "git+https://...", "git+ssh://..."
 * - Local path: "./path", "../path", "/absolute/path"
 */

/** Alias map for first-party adapter convenience names */
const BUILTIN_ALIASES: Record<string, string> = {
  opencode: '@agent-facets/adapter-opencode',
  'claude-code': '@agent-facets/adapter-claude-code',
  codex: '@agent-facets/adapter-codex',
  openclaw: '@agent-facets/adapter-openclaw',
}

export type ResolvedAdapterSpecifier =
  | { type: 'npm'; packageName: string }
  | { type: 'git'; url: string; commitish?: string }
  | { type: 'local'; path: string }

/**
 * Discriminated result for `parseAdapterSpecifier`. The success arm
 * carries the resolved source description; the failure arm carries
 * structured fields the CLI needs to render a precise message.
 *
 *   - `invalid-git-url` — the specifier started with `git+` but the
 *     URL after the prefix used a scheme outside the allowlist
 *     (https/http/ssh/git/file). Closes the F15 tar-slip / flag-injection
 *     hole at the boundary.
 */
export type ParseAdapterSpecifierResult =
  | { ok: true; resolved: ResolvedAdapterSpecifier }
  | { ok: false; reason: 'invalid-git-url'; specifier: string; url: string }

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
  // Check built-in aliases first
  const alias = BUILTIN_ALIASES[specifier]
  if (alias) {
    return { ok: true, resolved: { type: 'npm', packageName: alias } }
  }

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

  // Everything else is an npm package specifier
  return { ok: true, resolved: { type: 'npm', packageName: specifier } }
}

/** Returns the list of known built-in adapter names */
export function getBuiltinAdapterNames(): string[] {
  return Object.keys(BUILTIN_ALIASES)
}
