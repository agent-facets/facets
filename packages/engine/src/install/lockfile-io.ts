import { join } from 'node:path'
import {
  type AbsentFileState,
  atomicWriteFileSync,
  decodeFileText,
  describeInspectFailure,
  inspectFileState,
  type RegularFileState,
} from '@agent-facets/common'
import {
  CURRENT_LOCKFILE_VERSION,
  type CurrentLockfile,
  compareCodeUnits,
  type LockfileParseFailure,
  type ParsedLockfile,
  parseLockfileDocument,
  SUPPORTED_LOCKFILE_VERSIONS,
} from '@agent-facets/protocol'
import { jsonFileText } from '../json-file-text.ts'
import { ownRecord } from './own-entry.ts'

/**
 * Bytes-level I/O for facets.lock. Keeps JSON parse/serialize in one place
 * so the orchestrator only deals with validated lockfile values.
 *
 * Version dispatch is EXACT (design D10): `loadLockfile` delegates to
 * protocol's `parseLockfileDocument`, which selects the `0.2` or `0.3`
 * schema by exact equality — a version number names a schema, not a
 * position in a sequence. A future, unknown, or withdrawn version (the
 * closed-alpha `1`) is a structured `unsupported-lockfile-version`
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
 * The withdrawn closed-alpha lockfile version. Protocol no longer names it —
 * it is not a schema this CLI can read — but the failure renderer still has
 * to recognize it by exact value to give the right recovery advice.
 *
 * It is safe to delete because this CLI knows the format it names was
 * withdrawn, not because the number is small: `1` sorts above every supported
 * version while naming the oldest shape. Any other unrecognized number could
 * belong to a schema a teammate's newer CLI writes.
 */
const WITHDRAWN_ALPHA_LOCKFILE_VERSION = 1

/**
 * The outcome of loading a project's lockfile.
 *
 * `existed: false` is typed as the CURRENT version because that arm is
 * produced by {@link emptyLockfile}, not read from disk — a new project
 * never starts on an earlier schema. The `existed: true` arm carries
 * whatever version was actually on disk.
 *
 * `state` is the commit's write precondition, from the same read as `parsed`
 * and for the same reason as the manifest's.
 */
export type LoadLockfileResult =
  | {
      ok: true
      existed: false
      state: AbsentFileState
      parsed: { lockfileVersion: typeof CURRENT_LOCKFILE_VERSION; lockfile: CurrentLockfile }
    }
  | { ok: true; existed: true; state: RegularFileState; parsed: ParsedLockfile }
  | { ok: false; error: string }

export function loadLockfile(projectRoot: string): LoadLockfileResult {
  const path = join(projectRoot, FACETS_LOCK_FILE)
  const inspected = inspectFileState(path)
  if (!inspected.ok) {
    return { ok: false, error: `failed to read ${FACETS_LOCK_FILE}: ${describeInspectFailure(inspected.failure)}` }
  }
  if (inspected.state.kind === 'absent') {
    return {
      ok: true,
      existed: false,
      state: inspected.state,
      parsed: { lockfileVersion: CURRENT_LOCKFILE_VERSION, lockfile: emptyLockfile() },
    }
  }

  const parsed = parseLockfileDocument(decodeFileText(inspected.state.contents))
  if (!parsed.ok) {
    return { ok: false, error: describeLockfileFailure(parsed.failure) }
  }

  return { ok: true, existed: true, state: inspected.state, parsed: parsed.data }
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
        // A known-withdrawn version and an unrecognized one need opposite
        // remedies. A withdrawn format is safe to regenerate; an unrecognized
        // number may name a schema a newer CLI writes, and deleting that
        // would discard a teammate's resolutions. The two are told apart by
        // recognizing the withdrawn value exactly, never by comparing
        // magnitudes.
        (failure.observed === WITHDRAWN_ALPHA_LOCKFILE_VERSION
          ? `That format predates the current lockfile schema and is no longer read. Delete ${FACETS_LOCK_FILE} and re-run the install to regenerate it.`
          : `Upgrade the CLI, or delete ${FACETS_LOCK_FILE} to regenerate.`)
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
 * Top-level facet keys are sorted with {@link compareCodeUnits} so the output
 * is deterministic regardless of the insertion order the in-memory map was
 * built in — add/remove/add produces byte-identical output when the resolved
 * set is the same. Code-unit rather than locale ordering is what makes that
 * true across machines: `localeCompare` gives `@` and `/` variable weight, so
 * two developers with different ICU data could commit the same resolved set
 * with scoped facet names in different orders. (Same comparator as the
 * planner's reports, so a set cannot round-trip through them and come back
 * reordered.)
 *
 * Only `facets` is replaced. Rebuilding the document from its two known
 * fields would have discarded any unrecognized top-level field the caller
 * carried forward, which is the opposite of the preservation the format
 * promises — the caller's `preserveLockfileExtensions` would have done its
 * work only for the writer to undo it.
 */
export function writeLockfile(projectRoot: string, lockfile: CurrentLockfile): void {
  atomicWriteFileSync(join(projectRoot, FACETS_LOCK_FILE), canonicalLockfileText(lockfile))
}

/**
 * The exact bytes a lockfile serializes to.
 *
 * Split from the writer because the install commit needs the text without
 * performing the write: it hands the bytes to the transaction, which is what
 * makes the lockfile land in the same all-or-nothing batch as the manifest
 * and the receipt.
 */
export function canonicalLockfileText(lockfile: CurrentLockfile): string {
  // Null-prototype: re-materializing the map is the last place a facet can
  // silently disappear on its way to disk, and `__proto__` is a legal key of
  // the schema's `Record<string, …>`.
  const sortedFacets: CurrentLockfile['facets'] = ownRecord()
  for (const [key, entry] of Object.entries(lockfile.facets).sort(([a], [b]) => compareCodeUnits(a, b))) {
    sortedFacets[key] = entry
  }
  const canonical: CurrentLockfile = { ...lockfile, facets: sortedFacets }
  return jsonFileText(canonical)
}

/**
 * Bootstrap an empty lockfile at the current schema version. New projects
 * and fresh normal installs start current; earlier versions are only ever
 * input formats read from disk.
 */
export function emptyLockfile(): CurrentLockfile {
  return { lockfileVersion: CURRENT_LOCKFILE_VERSION, facets: {} }
}
