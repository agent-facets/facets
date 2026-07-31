import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@agent-facets/common'
import {
  CURRENT_LOCKFILE_VERSION,
  type CurrentLockfile,
  type LockfileParseFailure,
  type ParsedLockfile,
  parseLockfileDocument,
  SUPPORTED_LOCKFILE_VERSIONS,
} from '@agent-facets/protocol'
import { jsonFileText } from '../json-file-text.ts'

/**
 * Bytes-level I/O for facets.lock. Keeps JSON parse/serialize in one place
 * so the orchestrator only deals with validated lockfile values.
 *
 * Version dispatch is EXACT (design D10): `loadLockfile` delegates to
 * protocol's `parseLockfileDocument`, which selects the legacy-alpha `1`,
 * `0.2`, or `0.3` schema by exact equality — never numeric ordering, under
 * which `0.3 < 0.2 < 1` would rank the newest schema oldest. A
 * future/unknown version is a structured `unsupported-lockfile-version`
 * rejection, and a malformed document is never reinterpreted under another
 * version.
 *
 * The parsed result is carried through as protocol's tagged
 * `ParsedLockfile`, so the declared version and the document shape cannot
 * drift apart. Consumers that need per-file records or dispositions
 * discriminate on that tag; they never probe the shape.
 *
 * F4 note — closed-alpha posture: every persisted facet entry carries an
 * `integrity` field, but `loadLockfile` does NOT re-verify it against a
 * newly-resolved source. The lockfile is an audit log, not a tamper check.
 * Enforcement is deferred to the post-alpha work tracked under F12 (see
 * `.context/plans/` fast-follow plan).
 */

export const FACETS_LOCK_FILE = 'facets.lock'

/**
 * The outcome of loading a project's lockfile.
 *
 * `existed: false` is typed as the CURRENT version because that arm is
 * produced by {@link emptyLockfile}, not read from disk — a new project
 * never starts on an earlier schema. The `existed: true` arm carries
 * whatever version was actually on disk.
 */
export type LoadLockfileResult =
  | {
      ok: true
      existed: false
      parsed: { lockfileVersion: typeof CURRENT_LOCKFILE_VERSION; lockfile: CurrentLockfile }
    }
  | { ok: true; existed: true; parsed: ParsedLockfile }
  | { ok: false; error: string }

export function loadLockfile(projectRoot: string): LoadLockfileResult {
  const path = join(projectRoot, FACETS_LOCK_FILE)
  if (!existsSync(path)) {
    return {
      ok: true,
      existed: false,
      parsed: { lockfileVersion: CURRENT_LOCKFILE_VERSION, lockfile: emptyLockfile() },
    }
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

  return { ok: true, existed: true, parsed: parsed.data }
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
 * Serialize and write `facets.lock` atomically.
 *
 * Accepts only a CURRENT lockfile. An earlier document can be read and
 * reproduced, but never re-emitted: a normal install migrates forward, and
 * a frozen install leaves the file alone entirely rather than rewriting it.
 *
 * Top-level facet keys are sorted alphabetically so the output is
 * deterministic regardless of the insertion order the in-memory map was
 * built in — add/remove/add produces byte-identical output when the
 * resolved set is the same. (Same rationale as the per-facet asset sort in
 * `materialize.ts`.)
 */
export function writeLockfile(projectRoot: string, lockfile: CurrentLockfile): void {
  const path = join(projectRoot, FACETS_LOCK_FILE)
  const sortedFacets: CurrentLockfile['facets'] = {}
  for (const [key, entry] of Object.entries(lockfile.facets).sort(([a], [b]) => a.localeCompare(b))) {
    sortedFacets[key] = entry
  }
  const canonical: CurrentLockfile = { lockfileVersion: lockfile.lockfileVersion, facets: sortedFacets }
  atomicWriteFileSync(path, jsonFileText(canonical))
}

/**
 * Bootstrap an empty lockfile at the current schema version. New projects
 * and fresh normal installs start current; earlier versions are only ever
 * input formats read from disk.
 */
export function emptyLockfile(): CurrentLockfile {
  return { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} }
}
