/**
 * Parses an adapter install specifier into a resolved source type.
 *
 * Specifier formats:
 * - Built-in name: "opencode", "claude-code", "codex"
 * - npm package: "@scope/adapter-name" or "adapter-name"
 * - Git URL: "git+https://...", "git+ssh://..."
 * - Local path: "./path", "../path", "/absolute/path"
 */

/** CLI-owned alias map for first-party adapter convenience names */
const BUILTIN_ALIASES: Record<string, string> = {
  opencode: '@agent-facets/adapter-opencode',
  'claude-code': '@agent-facets/adapter-claude-code',
  codex: '@agent-facets/adapter-codex',
}

export type ResolvedSpecifier =
  | { type: 'npm'; packageName: string }
  | { type: 'git'; url: string; commitish?: string }
  | { type: 'local'; path: string }

// F15 — same scheme allowlist as the facet-side parseSource. Anything not in
// this set (notably leading `-` or nonsense schemes) is rejected before the
// URL reaches `git clone`.
const GIT_URL_SCHEME_RE = /^(https?|ssh|git|file):\/\//

/**
 * Parse an adapter install specifier into a resolved source description.
 * Does NOT perform I/O — just classifies and normalizes the input string.
 *
 * Throws on malformed git URLs (disallowed scheme) so callers don't have to
 * guard separately.
 */
export function parseSpecifier(specifier: string): ResolvedSpecifier {
  // Check built-in aliases first
  const alias = BUILTIN_ALIASES[specifier]
  if (alias) {
    return { type: 'npm', packageName: alias }
  }

  // Git URLs: git+https://, git+ssh://
  if (specifier.startsWith('git+')) {
    const raw = specifier.slice(4) // strip "git+" prefix
    const hashIndex = raw.indexOf('#')
    const url = hashIndex === -1 ? raw : raw.slice(0, hashIndex)
    const commitish = hashIndex === -1 ? undefined : raw.slice(hashIndex + 1)
    if (!GIT_URL_SCHEME_RE.test(url)) {
      throw new Error(`git URL must start with https://, http://, ssh://, or git:// — got "${url}"`)
    }
    return commitish !== undefined ? { type: 'git', url, commitish } : { type: 'git', url }
  }

  // Local paths: ./, ../, /absolute
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
    return { type: 'local', path: specifier }
  }

  // Everything else is an npm package specifier
  return { type: 'npm', packageName: specifier }
}

/** Returns the list of known built-in adapter names */
export function getBuiltinNames(): string[] {
  return Object.keys(BUILTIN_ALIASES)
}
