import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import type { FacetsJson } from '@agent-facets/protocol'
import { FACETS_JSON_FILE, removeFacetFromManifest } from '../manifest/mutations.ts'
import { loadFacetsJson, writeFacetsJson } from '../manifest/project-files.ts'
import { runInstall } from './run-install.ts'
import type { RunInstallResult, StageEvent } from './types.ts'

/**
 * The `facet remove` orchestrator. Owns the manifest transaction for the
 * remove flow on a developer's machine, mirroring {@link runAdd}:
 *
 *   1. Prepare: load `facets.json`, validate every named facet is declared,
 *      and snapshot the manifest. A missing/invalid manifest or an
 *      undeclared name fails here, before any mutation (there is nothing to
 *      remove). Extracted into {@link prepareRemove} so the CLI can run this
 *      read-only validation *before* discovering adapters — an undeclared
 *      facet must fail with the facet error and leave state untouched, never
 *      launching the adapter picker or reporting "no adapters installed".
 *   2. Remove every named entry; write the manifest.
 *   3. Run the install pipeline. The removed facets are now orphaned
 *      lockfile entries, so the existing drift-removal loop deletes their
 *      assets from every adapter and rewrites the lockfile without them.
 *   4. On install failure, restore the manifest snapshot byte-for-byte.
 *
 * Asset deletion and lockfile regeneration are NOT reimplemented here —
 * they are the install pipeline's existing drift-removal behavior. The
 * manifest snapshot/restore is an engine concern (filesystem mutation),
 * not CLI presentation. The CLI is a thin caller that renders this result.
 *
 * Never throws. Failures are reported via the discriminated result — the
 * snapshot read (in `prepareRemove`) and the manifest write are both guarded
 * and surface as a `manifest-write` prepare failure.
 */

export interface RunRemoveOptions {
  projectRoot: string
  /** Facet names (the `facets.json` keys) to remove — not source specifiers. */
  names: ReadonlyArray<string>
  adapters: ReadonlyArray<Adapter>
  /**
   * Pre-validated state from {@link prepareRemove}. The CLI calls
   * `prepareRemove` before adapter discovery and threads the result in here
   * so validation runs exactly once. When omitted (e.g. direct engine
   * callers and tests), `runRemove` prepares internally — so it remains
   * correct standalone.
   */
  prepared?: Extract<RemovePrepareResult, { ok: true }>
  onStage?: (event: StageEvent) => void
  onLog?: (line: string) => void
  signal?: AbortSignal
}

/**
 * Structured failure for the pre-install phase of `runRemove`. Tagged on
 * `reason` so each arm carries exactly the fields that reason implies:
 *   - `manifest-read`  — `facets.json` is missing, unreadable, or invalid;
 *                        there is nothing to remove.
 *   - `not-declared`   — one or more named facets are not declared in the
 *                        manifest. Carries every absent name so the CLI can
 *                        report them all in one shot (all-or-nothing).
 *   - `manifest-write` — reading the snapshot or writing the mutated
 *                        manifest hit an I/O error (permissions, disk full,
 *                        a race). The original `facets.json` is left intact
 *                        (the snapshot read never mutates; the write is
 *                        atomic — tmp + rename — so a throw leaves the
 *                        target untouched), so no install ran and nothing
 *                        needs restoring.
 */
export type RemovePrepareFailure =
  | { reason: 'manifest-read'; error: string }
  | { reason: 'not-declared'; names: ReadonlyArray<string> }
  | { reason: 'manifest-write'; error: string }

/**
 * Result of {@link prepareRemove}: the read-only validation + snapshot phase
 * of a remove. On success carries the parsed manifest to mutate and the
 * byte-for-byte snapshot used to restore on a later install failure.
 */
export type RemovePrepareResult =
  | { ok: true; json: FacetsJson; snapshot: Buffer | null }
  | { ok: false; failure: RemovePrepareFailure }

/**
 * Result of `runRemove`. Discriminated by `ok`.
 *
 *   - `{ ok: true; install }` — removal succeeded; the manifest no longer
 *     declares the removed facets and the lockfile has been rewritten.
 *   - `{ ok: false; phase: 'prepare'; failure }` — failed before any disk
 *     mutation (manifest read, or an undeclared name).
 *   - `{ ok: false; phase: 'install'; install; manifestRestored }` —
 *     install failed; the manifest snapshot has been restored.
 *     `install` is the underlying `runInstall` failure for the CLI to
 *     render; `manifestRestored` reports whether restore succeeded.
 */
export type RunRemoveResult =
  | { ok: true; install: Extract<RunInstallResult, { ok: true }> }
  | { ok: false; phase: 'prepare'; failure: RemovePrepareFailure }
  | {
      ok: false
      phase: 'install'
      install: Extract<RunInstallResult, { ok: false }>
      manifestRestored: boolean
    }

/**
 * The read-only validation + snapshot phase of a remove. Loads `facets.json`,
 * checks that every named facet is declared (collecting all absent names for
 * an all-or-nothing error), and snapshots the manifest for rollback.
 *
 * Extracted from `runRemove` so the CLI can run it *before* discovering
 * adapters: an undeclared facet or missing manifest must fail with the facet
 * error and leave the project untouched, never launching the adapter picker
 * or reporting "no adapters installed". Performs no mutation.
 *
 * Never throws — the snapshot read is guarded and surfaces as `manifest-write`.
 */
export function prepareRemove(opts: { projectRoot: string; names: ReadonlyArray<string> }): RemovePrepareResult {
  const { projectRoot, names } = opts

  // 1. Load facets.json. A missing or invalid manifest means there is
  //    nothing to remove — fail before any mutation.
  const loaded = loadFacetsJson(projectRoot)
  if (!loaded.ok) {
    return { ok: false, failure: { reason: 'manifest-read', error: loaded.error } }
  }
  if (!loaded.existed) {
    return { ok: false, failure: { reason: 'manifest-read', error: `no ${FACETS_JSON_FILE} found` } }
  }
  const json = loaded.data

  // 2. Validate every name is declared. Collect all absent names so the
  //    user sees the full set in one error (all-or-nothing — Decision 2/3).
  const absent = names.filter((name) => json.facets[name] === undefined)
  if (absent.length > 0) {
    return { ok: false, failure: { reason: 'not-declared', names: absent } }
  }

  // 3. Snapshot facets.json for rollback. Guard the read so an I/O error
  //    surfaces as a structured failure instead of escaping the function.
  const facetsJsonPath = join(projectRoot, FACETS_JSON_FILE)
  try {
    const snapshot: Buffer | null = existsSync(facetsJsonPath) ? readFileSync(facetsJsonPath) : null
    return { ok: true, json, snapshot }
  } catch (err) {
    return {
      ok: false,
      failure: { reason: 'manifest-write', error: err instanceof Error ? err.message : String(err) },
    }
  }
}

export async function runRemove(opts: RunRemoveOptions): Promise<RunRemoveResult> {
  const { projectRoot, names, adapters, signal } = opts
  const onStage = opts.onStage
  const onLog = opts.onLog

  // 1. Use the caller's pre-validated state, or prepare now. Threading
  //    `prepared` in from the CLI means validation runs exactly once;
  //    omitting it keeps `runRemove` correct for direct callers and tests.
  const prep = opts.prepared ?? prepareRemove({ projectRoot, names })
  if (!prep.ok) {
    return { ok: false, phase: 'prepare', failure: prep.failure }
  }
  const { json, snapshot } = prep
  const facetsJsonPath = join(projectRoot, FACETS_JSON_FILE)

  // 2. Remove every named entry and write the manifest. Guard the write so
  //    an I/O error surfaces as `manifest-write` rather than escaping. The
  //    write is atomic (tmp + rename) and no install has run yet, so a throw
  //    leaves the original `facets.json` intact — nothing to restore.
  for (const name of names) {
    removeFacetFromManifest(json, name)
    onLog?.(`[verbose]   removed "${name}" from ${FACETS_JSON_FILE}`)
  }
  try {
    writeFacetsJson(projectRoot, json)
  } catch (err) {
    return {
      ok: false,
      phase: 'prepare',
      failure: { reason: 'manifest-write', error: err instanceof Error ? err.message : String(err) },
    }
  }

  // 3. Run install. The removed facets are now orphaned lockfile entries;
  //    drift-removal deletes their assets and rewrites the lockfile.
  const install = await runInstall({
    projectRoot,
    adapters,
    ...(onStage ? { onStage } : {}),
    ...(onLog ? { onLog } : {}),
    ...(signal ? { signal } : {}),
  })

  // 4. Restore on failure; report whether the restore succeeded.
  if (!install.ok) {
    const manifestRestored = restoreSnapshot(facetsJsonPath, snapshot)
    return { ok: false, phase: 'install', install, manifestRestored }
  }

  return { ok: true, install }
}

/**
 * Restore the manifest snapshot. Returns whether the restore succeeded so
 * the CLI can warn the user when the project may be in a partial state.
 * Mirrors `runAdd`'s helper; the snapshot is non-null in practice because
 * `runRemove` requires the manifest to exist before mutating.
 */
function restoreSnapshot(path: string, snapshot: Buffer | null): boolean {
  try {
    if (snapshot === null) {
      if (existsSync(path)) rmSync(path)
      return true
    }
    writeFileSync(path, snapshot)
    return true
  } catch {
    return false
  }
}
