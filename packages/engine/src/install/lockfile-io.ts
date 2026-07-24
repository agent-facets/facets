import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@agent-facets/common'
import {
  CURRENT_LOCKFILE_VERSION,
  type LEGACY_LOCKFILE_VERSION,
  type Lockfile,
  type LockfileParseFailure,
  parseLockfileDocument,
  SUPPORTED_LOCKFILE_VERSIONS,
} from '@agent-facets/protocol'
import { jsonFileText } from '../json-file-text.ts'

/**
 * Bytes-level I/O for facets.lock. Keeps JSON parse/serialize in one place
 * so the orchestrator only deals with validated Lockfile values.
 *
 * Version dispatch is EXACT (design D10): `loadLockfile` delegates to
 * protocol's `parseLockfileDocument`, which selects the legacy-alpha `1`
 * schema or the current `0.2` schema by exact equality — never numeric
 * ordering. A future/unknown version is a structured
 * `unsupported-lockfile-version` rejection, and a malformed `0.2` lockfile
 * is never reinterpreted as legacy `1`. The loaded version is surfaced on
 * the result so the orchestrator can migrate a legacy lockfile to `0.2`
 * in normal mode while retaining it verbatim in frozen mode.
 *
 * F4 note — closed-alpha posture: every persisted facet entry carries an
 * `integrity` field, but `loadLockfile` does NOT re-verify it against a
 * newly-resolved source. The lockfile is an audit log, not a tamper check.
 * Enforcement is deferred to the post-alpha work tracked under F12 (see
 * `.context/plans/` fast-follow plan).
 */

export const FACETS_LOCK_FILE = 'facets.lock'

/**
 * The exact schema version a lockfile was loaded under. Legacy `1` carries
 * identity-only asset entries; current `0.2` carries per-materialized-file
 * integrity records. The orchestrator dispatches migration behavior on this
 * discriminant rather than re-parsing the version out of `data`.
 */
export type LoadedLockfileVersion = typeof LEGACY_LOCKFILE_VERSION | typeof CURRENT_LOCKFILE_VERSION

export type LoadLockfileResult =
  | { ok: true; data: Lockfile; existed: boolean; version: LoadedLockfileVersion }
  | { ok: false; error: string }

export function loadLockfile(projectRoot: string): LoadLockfileResult {
  const path = join(projectRoot, FACETS_LOCK_FILE)
  if (!existsSync(path)) {
    // A missing lockfile bootstraps the current (`0.2`) empty shape — new
    // projects never start on the legacy schema.
    return { ok: true, data: emptyLockfile(), existed: false, version: CURRENT_LOCKFILE_VERSION }
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

  const parsed = parseLockfileDocument(raw)
  if (!parsed.ok) {
    return { ok: false, error: describeLockfileFailure(parsed.failure) }
  }

  // `CurrentLockfile` asset entries are a structural superset of the
  // permissive `Lockfile` (identity fields plus `files`), so a current
  // document reads correctly through the still-legacy downstream install
  // paths; the per-file records are threaded through explicitly by the
  // lockfile `0.2` materialization work.
  return {
    ok: true,
    data: parsed.data.lockfile as Lockfile,
    existed: true,
    version: parsed.data.lockfileVersion,
  }
}

/**
 * Render protocol's tagged `LockfileParseFailure` into the actionable
 * string the orchestrator surfaces today. Structured install-failure
 * variants replace this string channel in the per-file reconciliation work.
 */
function describeLockfileFailure(failure: LockfileParseFailure): string {
  switch (failure.code) {
    case 'invalid-json':
      return `${FACETS_LOCK_FILE} is malformed JSON: ${summarizeErrors(failure.errors)}`
    case 'duplicate-members':
      return `${FACETS_LOCK_FILE} contains duplicate object member names: ${summarizeErrors(failure.errors)}`
    case 'unsupported-lockfile-version':
      return (
        `${FACETS_LOCK_FILE} declares an unsupported lockfileVersion ` +
        `(${failure.observed ?? 'missing'}, this CLI supports ${SUPPORTED_LOCKFILE_VERSIONS.join(', ')}). ` +
        `Upgrade the CLI, or delete ${FACETS_LOCK_FILE} to regenerate.`
      )
    case 'schema-violation':
      return `${FACETS_LOCK_FILE} is invalid (lockfileVersion ${failure.lockfileVersion}): ${summarizeErrors(failure.errors)}`
  }
}

function summarizeErrors(errors: ReadonlyArray<{ message: string }>): string {
  return errors.map((e) => e.message).join('; ')
}

/**
 * Serialize and write `facets.lock` atomically. Top-level facet keys are
 * sorted alphabetically so the output is deterministic regardless of the
 * insertion order the in-memory map was built in — add/remove/add produces
 * byte-identical output when the resolved set is the same. (Same rationale
 * as the per-facet asset sort in `materialize.ts`.)
 */
export function writeLockfile(projectRoot: string, lockfile: Lockfile): void {
  const path = join(projectRoot, FACETS_LOCK_FILE)
  const sortedFacets: Lockfile['facets'] = {}
  for (const [key, entry] of Object.entries(lockfile.facets).sort(([a], [b]) => a.localeCompare(b))) {
    sortedFacets[key] = entry
  }
  const canonical: Lockfile = { lockfileVersion: lockfile.lockfileVersion, facets: sortedFacets }
  atomicWriteFileSync(path, jsonFileText(canonical))
}

/**
 * Bootstrap an empty lockfile at the current (`0.2`) schema version. New
 * projects and fresh normal installs start current; legacy `1` is only ever
 * an input format read from disk.
 */
export function emptyLockfile(): Lockfile {
  return { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} }
}
