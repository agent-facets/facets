import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse, stringify } from 'ini'
import { facetCredentialsPath, resolveFacetDir } from '../facet-dir.ts'

/**
 * The credential used to authenticate against the registry, tagged with
 * the source it was resolved from.
 *
 * "Absent" is a normal outcome, not a failure: read commands proceed
 * anonymously when no credential is available (see registry client
 * D3). Modeling absence as an explicit arm — rather than an empty
 * string or `undefined` — keeps the missing-credential path a
 * compile-time obligation at every call site, and lets callers render
 * source-aware notices (e.g. `whoami` indicating the env var is in
 * use, `login`/`logout` warning the env var shadows the file).
 *
 * The `absent` arm carries an optional `reason`. It is omitted for the
 * ordinary "not logged in" case (no env token, no credentials file, or
 * a readable file that simply has no token). It is present only when a
 * credentials file exists but could not be read at all (a directory at
 * the path, bad permissions, a dangling symlink). Behavior on `absent`
 * is identical regardless of `reason` — there is no token to send — but
 * the diagnostic lets callers explain the misconfiguration: read
 * commands warn and proceed anonymously; credential-requiring commands
 * surface it as a pre-flight failure.
 */
export type ResolvedCredential =
  | { source: 'env'; token: string }
  | { source: 'file'; token: string }
  | { source: 'absent'; reason?: { code: 'unreadable'; path: string; cause: string } }

/**
 * Resolve the registry credential with precedence:
 *
 *   1. `FACET_TOKEN` env var, when set to a non-empty (trimmed) value.
 *   2. The token persisted at `$FACET_DIR/credentials`.
 *   3. Absent — no credential available.
 *
 * Whitespace-only `FACET_TOKEN` (`FACET_TOKEN=`, `FACET_TOKEN=" "`) is
 * treated as unset, mirroring the `FACET_DIR` convention so a
 * misconfiguration doesn't send an empty Bearer token.
 *
 * Read on every call (not memoized) so test harnesses and subprocesses
 * can redirect via `process.env` per case.
 */
export function resolveCredential(): ResolvedCredential {
  const envToken = process.env.FACET_TOKEN?.trim()
  if (envToken !== undefined && envToken.length > 0) {
    return { source: 'env', token: envToken }
  }

  const file = readCredentialsFile()
  if (file.kind === 'token') {
    return { source: 'file', token: file.token }
  }
  if (file.kind === 'unreadable') {
    return { source: 'absent', reason: { code: 'unreadable', path: facetCredentialsPath(), cause: file.cause } }
  }

  return { source: 'absent' }
}

/**
 * Outcome of attempting to read a token from the credentials file:
 *
 *   - `token`      — a readable file with a non-empty `[default].token`.
 *   - `none`       — no file at all, OR a readable file that has no
 *                    usable token (missing `[default]` section, missing
 *                    `token` key, or empty/whitespace token). This is
 *                    the ordinary "not logged in" state, not an error.
 *   - `unreadable` — the file exists but `readFileSync` threw (e.g. a
 *                    directory at the path, bad permissions, a dangling
 *                    symlink — note `existsSync` follows symlinks, so a
 *                    stale symlink passes the existence check and only
 *                    fails here). The `cause` is the thrown message.
 */
type ReadCredentialsFileResult =
  | { kind: 'token'; token: string }
  | { kind: 'none' }
  | { kind: 'unreadable'; cause: string }

/**
 * Read and classify the credentials file. A read failure is returned as
 * data (`unreadable`) rather than thrown, so `resolveCredential` never
 * escapes with an uncaught filesystem exception on user-controlled local
 * state. A file that reads cleanly but carries no token is `none`, not
 * `unreadable` — it is readable, just not logged in.
 */
function readCredentialsFile(): ReadCredentialsFileResult {
  const path = facetCredentialsPath()
  if (!existsSync(path)) {
    return { kind: 'none' }
  }

  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch (err) {
    return { kind: 'unreadable', cause: err instanceof Error ? err.message : String(err) }
  }

  const parsed = parse(contents)
  const profile = parsed.default
  if (typeof profile !== 'object' || profile === null) {
    return { kind: 'none' }
  }

  const token = (profile as Record<string, unknown>).token
  if (typeof token !== 'string') {
    return { kind: 'none' }
  }

  const trimmed = token.trim()
  return trimmed.length > 0 ? { kind: 'token', token: trimmed } : { kind: 'none' }
}

/**
 * Read the `token` from the `[default]` profile of the credentials
 * file. Returns `undefined` when the file is absent, unreadable, the
 * `[default]` section or `token` key is missing, or the token is
 * empty/whitespace. An absent or unreadable file is not surfaced as an
 * error here — callers that need to distinguish "unreadable" from "not
 * logged in" use `resolveCredential`, whose `absent` arm carries the
 * reason. This wrapper preserves the simple `string | undefined`
 * contract for callers that only want the token.
 */
export function readCredentialsToken(): string | undefined {
  const file = readCredentialsFile()
  return file.kind === 'token' ? file.token : undefined
}

/**
 * Persist `token` to the `[default]` profile of the credentials file
 * with owner-only (`0o600`) permissions. Creates `$FACET_DIR` if it
 * does not exist. The `chmod` is explicit because `writeFileSync`'s
 * `mode` is honored only on file creation — overwriting an existing
 * file leaves its prior permissions untouched, so a credentials file
 * that somehow became world-readable would stay that way without the
 * explicit `chmod`.
 */
export function writeCredentialsToken(token: string): void {
  const path = facetCredentialsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringify({ default: { token } }), { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

/**
 * Delete the credentials file. Returns `true` when a file was removed,
 * `false` when there was nothing to remove. Makes no server call —
 * server-side token revocation is performed by the user in the web UI.
 */
export function deleteCredentialsFile(): boolean {
  const path = facetCredentialsPath()
  if (!existsSync(path)) {
    return false
  }
  // `force: true` makes deletion race-tolerant: if the file vanishes
  // between the `existsSync` check above and this call (a concurrent
  // logout, a script, the user), `rmSync` is a no-op instead of throwing
  // ENOENT and turning `facet logout` into a hard failure. The boolean
  // return still reflects the `existsSync` snapshot — a benign white lie
  // in the rare race window, where the end state ("no credentials file")
  // is what the user wanted either way.
  rmSync(path, { force: true })
  return true
}

// `resolveFacetDir` is re-exported here as a convenience for callers
// that need to surface the resolved root in user-facing messages
// (e.g. "no credentials at <dir>"). It is intentionally not re-wrapped.
export { resolveFacetDir }
