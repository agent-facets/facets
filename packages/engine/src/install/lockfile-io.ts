import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@agent-facets/common'
import { LOCKFILE_VERSION, type Lockfile, LockfileSchema } from '@agent-facets/protocol'
import { type } from 'arktype'

/**
 * Bytes-level I/O for facets.lock. Keeps JSON parse/serialize in one place
 * so the orchestrator only deals with validated Lockfile values.
 *
 * F4 note — closed-alpha posture: every persisted facet entry carries an
 * `integrity` field, but `loadLockfile` does NOT re-verify it against a
 * newly-resolved source. The lockfile is an audit log, not a tamper check.
 * Enforcement is deferred to the post-alpha work tracked under F12 (see
 * `.context/plans/` fast-follow plan).
 */

export const FACETS_LOCK_FILE = 'facets.lock'

export type LoadLockfileResult = { ok: true; data: Lockfile; existed: boolean } | { ok: false; error: string }

export function loadLockfile(projectRoot: string): LoadLockfileResult {
  const path = join(projectRoot, FACETS_LOCK_FILE)
  if (!existsSync(path)) {
    return { ok: true, data: emptyLockfile(), existed: false }
  }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return {
      ok: false,
      error: `failed to read ${FACETS_LOCK_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      ok: false,
      error: `${FACETS_LOCK_FILE} is malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  // F9 — forward-compat guard. If the file is from a newer CLI that bumped
  // `lockfileVersion`, stop before schema validation so the user sees an
  // actionable message instead of a confusing arktype mismatch. A lockfile
  // with a matching or older version falls through to the schema below.
  const parsedVersion = (parsed as { lockfileVersion?: unknown } | null)?.lockfileVersion
  if (typeof parsedVersion === 'number' && parsedVersion > LOCKFILE_VERSION) {
    return {
      ok: false,
      error: `${FACETS_LOCK_FILE} is from a newer facet CLI (lockfileVersion ${parsedVersion}, this CLI supports ${LOCKFILE_VERSION}). Upgrade the CLI, or delete ${FACETS_LOCK_FILE} to regenerate.`,
    }
  }
  const validated = LockfileSchema(parsed)
  if (validated instanceof type.errors) {
    return { ok: false, error: `${FACETS_LOCK_FILE} is invalid: ${validated.summary}` }
  }
  return { ok: true, data: validated as Lockfile, existed: true }
}

export function writeLockfile(projectRoot: string, lockfile: Lockfile): void {
  const path = join(projectRoot, FACETS_LOCK_FILE)
  atomicWriteFileSync(path, `${JSON.stringify(lockfile, null, 2)}\n`)
}

export function emptyLockfile(): Lockfile {
  return { lockfileVersion: LOCKFILE_VERSION, facets: {} }
}
