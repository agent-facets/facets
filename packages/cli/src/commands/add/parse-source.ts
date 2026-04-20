/**
 * Parses a facet source specifier into a resolved source description.
 *
 * Supported forms (closed alpha):
 *   - `github:<owner>/<repo>[#<ref>]`   → github shortcut (HTTPS under the hood)
 *   - `git+https://.../<repo>.git[#<ref>]`
 *   - `git+ssh://.../<repo>.git[#<ref>]`
 *   - `https://.../<repo>.git[#<ref>]`  → treated as git+https
 *   - `file:./<relative>`               → local path (relative to cwd)
 *   - `file:/<absolute>`                → local absolute path
 *
 * Rejected in closed alpha:
 *   - Bare registry names (e.g., "viper-plans") → roadmap; registry
 *     resolution is open-beta scope.
 *
 * This is a PURE function. Callers are responsible for I/O (cloning,
 * validating existence).
 */

export type ParsedSource = { type: 'git'; url: string; commitish?: string } | { type: 'local'; path: string }

export type ParseSourceResult = { ok: true; data: ParsedSource } | { ok: false; error: string }

const GITHUB_SHORTCUT_RE = /^github:([^/\s]+)\/([^/\s#]+)(?:#(.+))?$/
const LOCAL_RELATIVE_RE = /^file:(\.\.?\/.*|\.\.?)$/
const LOCAL_ABSOLUTE_RE = /^file:(\/.*)$/

export function parseSource(specifier: string): ParseSourceResult {
  if (specifier.length === 0) {
    return { ok: false, error: 'empty source specifier' }
  }

  // github:<owner>/<repo>[#<ref>]
  const githubMatch = specifier.match(GITHUB_SHORTCUT_RE)
  if (githubMatch) {
    const [, owner, repo, commitish] = githubMatch
    const url = `https://github.com/${owner}/${repo}.git`
    return { ok: true, data: commitish ? { type: 'git', url, commitish } : { type: 'git', url } }
  }

  // git+https://..., git+ssh://...
  if (specifier.startsWith('git+')) {
    return parseGitUrl(specifier.slice(4))
  }

  // https://.../<repo>.git — treat as git+https
  if (specifier.startsWith('https://') && specifier.includes('.git')) {
    return parseGitUrl(specifier)
  }

  // file:/abs/path
  const absMatch = specifier.match(LOCAL_ABSOLUTE_RE)
  if (absMatch) {
    return { ok: true, data: { type: 'local', path: absMatch[1] ?? '' } }
  }

  // file:./rel/path
  const relMatch = specifier.match(LOCAL_RELATIVE_RE)
  if (relMatch) {
    return { ok: true, data: { type: 'local', path: relMatch[1] ?? '' } }
  }

  // Bare names are reserved for the future registry; reject explicitly so
  // partners see a clear roadmap pointer instead of a confusing git error.
  if (!specifier.includes('://') && !specifier.startsWith('file:')) {
    return {
      ok: false,
      error: `bare registry names (e.g., "${specifier}") are not supported in closed alpha`,
    }
  }

  return { ok: false, error: `unrecognized source format: "${specifier}"` }
}

/**
 * Accept only URLs whose scheme is one of https/http/ssh/git/file. Everything
 * else (notably leading `-` which `git clone` would interpret as a flag) is
 * rejected here so the URL never reaches the spawn call. Closed alpha
 * explicitly supports these schemes only (F15 hardening). `file://` is
 * retained for test fixtures — real partners use the `file:` (no slashes)
 * local-path form, which routes through the `local` branch, not this one.
 */
const GIT_URL_SCHEME_RE = /^(https?|ssh|git|file):\/\//

function parseGitUrl(raw: string): ParseSourceResult {
  const hashIndex = raw.indexOf('#')
  const url = hashIndex === -1 ? raw : raw.slice(0, hashIndex)
  const commitish = hashIndex === -1 ? undefined : raw.slice(hashIndex + 1)

  if (!GIT_URL_SCHEME_RE.test(url)) {
    return {
      ok: false,
      error: `git URL must start with https://, http://, ssh://, or git:// — got "${url}"`,
    }
  }

  return {
    ok: true,
    data: commitish !== undefined ? { type: 'git', url, commitish } : { type: 'git', url },
  }
}
