/**
 * Parses a harness install specifier into a resolved source type.
 *
 * Specifier formats:
 * - Built-in name: "opencode", "claude-code", "codex"
 * - npm package: "@scope/harness-name" or "harness-name"
 * - Git URL: "git+https://...", "git+ssh://..."
 * - Local path: "./path", "../path", "/absolute/path"
 */

/** CLI-owned alias map for first-party harness convenience names */
const BUILTIN_ALIASES: Record<string, string> = {
  opencode: '@agent-facets/harness-opencode',
  'claude-code': '@agent-facets/harness-claude-code',
  codex: '@agent-facets/harness-codex',
}

export type ResolvedSpecifier =
  | { type: 'npm'; packageName: string }
  | { type: 'git'; url: string; commitish?: string }
  | { type: 'local'; path: string }

/**
 * Parse a harness install specifier into a resolved source description.
 * Does NOT perform I/O — just classifies and normalizes the input string.
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
    if (hashIndex !== -1) {
      return {
        type: 'git',
        url: raw.slice(0, hashIndex),
        commitish: raw.slice(hashIndex + 1),
      }
    }
    return { type: 'git', url: raw }
  }

  // Local paths: ./, ../, /absolute
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
    return { type: 'local', path: specifier }
  }

  // Everything else is an npm package specifier
  return { type: 'npm', packageName: specifier }
}

/** Returns the list of known built-in harness names */
export function getBuiltinNames(): string[] {
  return Object.keys(BUILTIN_ALIASES)
}
