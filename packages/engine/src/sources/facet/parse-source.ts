import { parseFacetName } from '@agent-facets/protocol'
import { parseVersionSpec } from './parse-version.ts'
import type { ParseError, ParseErrorCode, ParseResult, Source } from './types.ts'

/**
 * Path-detection regex (combined POSIX + Windows alternatives).
 * Matches: `.`, `..`, `./*`, `../*`, `~/*`, `/abs`, `\abs`, `C:/*`, `C:\*`.
 *
 * Adapted from `npm/npm-package-arg/lib/npa.js` (ISC, Copyright npm Inc.).
 * The original branches `isPosixFile` vs `isWindowsFile` on `process.platform`;
 * we collapse them into a single cross-platform regex because Source parsing
 * is platform-independent — what looks like a path to a Windows user looks
 * like a path to a macOS user too.
 */
const PATH_RE = /^(?:[.]|~[/]|[/\\]|[a-zA-Z]:[/\\])/

/**
 * SCP-style git URL regex (`user@host.tld:path`).
 *
 * Adapted from `npm/npm-package-arg/lib/npa.js` (ISC, Copyright npm Inc.).
 * Requires: a username before `@` (no `@` allowed in username), a host
 * containing at least one literal dot and no colons, then a colon and
 * a non-empty path.
 */
const SCP_RE = /^[^@]+@[^:.]+\.[^:]+:.+$/i

/**
 * GitHub shorthand: `github:owner/repo[#ref]`.
 */
const GITHUB_RE = /^github:([^/\s]+)\/([^#\s]+?)(?:\.git)?(?:#(.+))?$/

/**
 * URL-with-scheme regex.
 */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i

/**
 * Schemes we accept for git sources.
 */
const GIT_SCHEMES = new Set(['https', 'http', 'ssh', 'git'])

/**
 * Registry name regex. Lowercase letters, digits, hyphens; must start
 * with a letter. A name segment may optionally be followed by `/<segment>`
 * to form a namespaced name (`<namespace>/<name>`), where the second
 * segment matches the same character class. Group 1 captures the canonical
 * full name (with the slash if present). Optional `@<version-spec>` tail.
 */
const REGISTRY_RE = /^([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)(?:@(.+))?$/

/**
 * Parse a facet source string into a `Source`.
 *
 * Pure function: no I/O, no exceptions, deterministic.
 *
 * Priority order (first match wins):
 *   1. Empty                                    → reject EMPTY
 *   2. `git+` prefix                            → reject GIT_PLUS_PREFIX
 *   3. `file:` prefix                           → strip and recurse
 *   4. `github:owner/repo[#ref]`                → git
 *   5. PATH_RE                                  → local
 *   6. SCP_RE                                   → git (split on `#`)
 *   7. has scheme                               → git (if path ends in `.git`) | reject
 *   8. leading `@`                              → scoped registry name + parseVersionSpec
 *   9. otherwise                                → registry name + parseVersionSpec
 */
export function parseFacetSource(input: string): ParseResult<Source> {
  if (input.length === 0) {
    return err(
      'EMPTY',
      'empty source specifier',
      'provide a registry name, github:owner/repo, https URL, or local path',
    )
  }

  // Hard-reject `git+` prefix per the source-grammar decision.
  if (input.startsWith('git+')) {
    return err(
      'GIT_PLUS_PREFIX',
      `git+ prefix is not supported (got "${input}")`,
      'use https://...git, ssh://..., or git@host:owner/repo without the git+ prefix',
    )
  }

  // Tolerate-and-strip `file:` prefix.
  if (input.startsWith('file:')) {
    const stripped = input.slice('file:'.length)
    if (stripped.length === 0) {
      return err('EMPTY', 'empty file: specifier', 'use file:./relative/path or file:/absolute/path')
    }
    return parseFacetSource(stripped)
  }

  // GitHub shorthand.
  const githubMatch = GITHUB_RE.exec(input)
  if (githubMatch && githubMatch[1] !== undefined && githubMatch[2] !== undefined) {
    const owner = githubMatch[1]
    const repo = githubMatch[2]
    const ref = githubMatch[3]
    return ok({
      kind: 'git',
      url: `https://github.com/${owner}/${repo}.git`,
      ...(ref !== undefined ? { ref } : {}),
    })
  }

  // Local path.
  if (PATH_RE.test(input)) {
    return ok({ kind: 'local', path: input })
  }

  // SCP-style git URL.
  if (SCP_RE.test(input)) {
    const hashIndex = input.indexOf('#')
    if (hashIndex === -1) {
      return ok({ kind: 'git', url: input })
    }
    const url = input.slice(0, hashIndex)
    const ref = input.slice(hashIndex + 1)
    return ok({ kind: 'git', url, ...(ref.length > 0 ? { ref } : {}) })
  }

  // URL with scheme.
  const schemeMatch = SCHEME_RE.exec(input)
  if (schemeMatch && schemeMatch[1] !== undefined) {
    const scheme = schemeMatch[1].toLowerCase()
    if (!GIT_SCHEMES.has(scheme)) {
      return err(
        'UNKNOWN_SCHEME',
        `unsupported URL scheme "${scheme}" in "${input}"`,
        'use https://, http://, ssh://, or git://',
      )
    }
    const hashIndex = input.indexOf('#')
    const url = hashIndex === -1 ? input : input.slice(0, hashIndex)
    const ref = hashIndex === -1 ? '' : input.slice(hashIndex + 1)
    // Require the path to look like a git repo (ends in .git, ignoring ref).
    if (!url.endsWith('.git')) {
      return err(
        'UNKNOWN_SCHEME',
        `URL "${url}" does not look like a git repository`,
        'append .git to the URL, or use github:owner/repo shorthand',
      )
    }
    return ok({ kind: 'git', url, ...(ref.length > 0 ? { ref } : {}) })
  }

  // Scoped registry name (`@scope/name`, optionally `@scope/name@version`).
  //
  // The leading `@` is the scope marker; a *subsequent* `@` (after the
  // `@scope/name` segment) is the version separator. We split the version
  // tail on the LAST `@` so `@scope/name@1.2.3` parses as name `@scope/name`
  // + version `1.2.3`, while `@scope/name` (no second `@`) is a bare latest.
  // The name portion is validated with protocol's `parseFacetName`, the
  // single source of truth for scoped-name grammar. Malformed scoped forms
  // (`@scope`, `@scope/`, `@/name`, `@scope/name@`, etc.) return typed
  // parse failures.
  if (input.startsWith('@')) {
    const lastAt = input.lastIndexOf('@')
    // A scoped name always has the scope `@` at index 0. If that's the only
    // `@`, there is no version tail; otherwise the last `@` separates the
    // version. `@scope/name@` (empty tail) is rejected by parseVersionSpec
    // below via the empty-name fallthrough.
    const hasVersionTail = lastAt > 0
    const namePart = hasVersionTail ? input.slice(0, lastAt) : input
    const versionPart = hasVersionTail ? input.slice(lastAt + 1) : undefined

    const nameResult = parseFacetName(namePart)
    if (!nameResult.ok) {
      return err(
        'INVALID_REGISTRY_NAME',
        `invalid scoped facet name "${namePart}": ${nameResult.reason}`,
        'use a scoped registry name of the form @scope/name (e.g., @julian/cowsay)',
      )
    }

    if (versionPart === undefined) {
      // Bare scoped name — equivalent to `@scope/name@latest`.
      return ok({ kind: 'registry', name: nameResult.canonical, version: { kind: 'latest' } })
    }
    if (versionPart === '') {
      return err(
        'INVALID_REGISTRY_NAME',
        `scoped facet name "${input}" has an empty version after "@"`,
        'provide a version (e.g., @scope/name@1.2.3) or omit the trailing @',
      )
    }
    const scopedVersionResult = parseVersionSpec(versionPart)
    if (!scopedVersionResult.ok) {
      return { ok: false, error: scopedVersionResult.error }
    }
    return ok({ kind: 'registry', name: nameResult.canonical, version: scopedVersionResult.value })
  }

  // Registry name (with optional version tail).
  const registryMatch = REGISTRY_RE.exec(input)
  if (registryMatch && registryMatch[1] !== undefined) {
    const name = registryMatch[1]
    const versionPart = registryMatch[2]
    if (versionPart === undefined) {
      // Bare name — equivalent to `name@latest`.
      return ok({ kind: 'registry', name, version: { kind: 'latest' } })
    }
    const versionResult = parseVersionSpec(versionPart)
    if (!versionResult.ok) {
      // Surface the version error with its own code so callers can branch.
      return { ok: false, error: versionResult.error }
    }
    return ok({ kind: 'registry', name, version: versionResult.value })
  }

  return err(
    'INVALID_REGISTRY_NAME',
    `unrecognized source specifier "${input}"`,
    'use a registry name (e.g., viper-plans), github:owner/repo, https://...git, git@host:owner/repo, or a local path',
  )
}

function ok(value: Source): ParseResult<Source> {
  return { ok: true, value }
}

function err(code: ParseErrorCode, what: string, fix: string): ParseResult<Source> {
  const error: ParseError = { code, what, fix }
  return { ok: false, error }
}
