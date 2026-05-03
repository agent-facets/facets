import type { Adapter } from '@agent-facets/adapter'
import type { ValidationError } from '@agent-facets/common'
import type { IntegrityFailure, Lockfile, LockfileAssetEntry } from '@agent-facets/protocol'
import type { RegistryError } from '../registry/index.ts'
import type { ParseError } from '../sources/facet/types.ts'

/**
 * Per-facet outcome reported in the result. View layers render one
 * summary line per outcome.
 *
 *   - `installed`: facet was not in the previous lockfile.
 *   - `updated`: facet was in the previous lockfile at a different version.
 *   - `repaired`: facet was in the previous lockfile at the same version,
 *     but at least one asset was rewritten because the on-disk state had
 *     drifted (user deleted a file, edited content, etc.). Lockfile
 *     entry is the same as before.
 *   - `unchanged`: facet was in the previous lockfile at the same
 *     version AND every asset was already in its desired state on disk
 *     (no writes performed).
 *   - `removed`: facet was in the previous lockfile but is no longer
 *     declared in `facets.json`; its assets were cleaned up.
 */
export type FacetOutcome =
  | { kind: 'installed'; name: string; version: string }
  | { kind: 'updated'; name: string; oldVersion: string; newVersion: string }
  | { kind: 'repaired'; name: string; version: string }
  | { kind: 'unchanged'; name: string; version: string }
  | { kind: 'removed'; name: string; oldVersion: string }

/**
 * Aggregate counts for the post-install summary line.
 */
export interface InstallSummary {
  installed: number
  updated: number
  repaired: number
  unchanged: number
  removed: number
  /** Assets actually written across all facets (excludes skipped no-ops). */
  totalAssets: number
  removedAssets: number
}

/**
 * Per-facet stages emitted via `onStage`. Used by view layers to
 * render fine-grained progress.
 */
export type FacetStage = 'parse' | 'resolve' | 'fetch' | 'verify' | 'load' | 'build' | 'materialize'

/**
 * Structured progress event. View layers subscribe via the `onStage`
 * callback and render whatever subset they care about.
 */
export type StageEvent =
  | { kind: 'install-start'; totalFacets: number }
  | { kind: 'facet-start'; facet: string; specifier: string }
  | { kind: 'facet-stage'; facet: string; stage: FacetStage }
  | { kind: 'facet-success'; facet: string; outcome: FacetOutcome }
  | { kind: 'facet-failure'; facet: string; failure: RunInstallFailure }
  | { kind: 'server-warning'; facet: string; servers: ReadonlyArray<string> }
  | { kind: 'drift-removal'; facet: string; oldVersion: string }
  | { kind: 'asset-installed'; facet: string; adapter: string; asset: LockfileAssetEntry }
  | { kind: 'asset-deleted'; facet: string; adapter: string; asset: LockfileAssetEntry }
  | { kind: 'lockfile-write'; path: string }
  | { kind: 'install-complete'; outcome: 'success' | 'failure' | 'aborted' }

/**
 * Discriminated failure type for `runInstall`. Every failure mode
 * carries the structured fields a view layer needs to render the
 * failure without parsing message strings.
 */
export type RunInstallFailure =
  | { code: 'FACETS_JSON_NOT_FOUND'; path: string }
  | { code: 'FACETS_JSON_INVALID'; path: string; error: string }
  | { code: 'LOCKFILE_INVALID'; path: string; error: string }
  | { code: 'LOCKFILE_WRITE_FAILED'; path: string; cause: string }
  | { code: 'LOCK_HELD'; path: string; heldByPid: number }
  | { code: 'PARSE_ERROR'; facet: string; specifier: string; error: ParseError }
  | { code: 'REGISTRY_ERROR'; facet: string; error: RegistryError }
  | { code: 'INTEGRITY_FAILURE'; failure: IntegrityFailure }
  | {
      code: 'CACHE_INTEGRITY_MISMATCH'
      facet: string
      slotPath: string
      cachedIntegrity: string
      lockedIntegrity: string
    }
  | { code: 'COMPOSITION_REJECTED'; facet: string }
  | { code: 'GIT_CLONE_FAILED'; facet: string; cause: string }
  | { code: 'LOCAL_RESOLVE_FAILED'; facet: string; cause: string }
  | { code: 'BUILD_FAILED'; facet: string; errors: ReadonlyArray<ValidationError> }
  | { code: 'MANIFEST_NAME_MISMATCH'; facet: string; manifestName: string }
  | { code: 'MANIFEST_LOAD_FAILED'; facet: string; errors: ReadonlyArray<ValidationError> }
  | { code: 'ADAPTER_INSTALL_FAILED'; facet: string; adapter: string; cause: string }
  | { code: 'ABORTED' }

/**
 * Result of a `runInstall` invocation. Discriminated by `ok`.
 *
 * On success, callers receive the new lockfile (already written to
 * disk), a summary of counts, per-facet outcomes, and any server
 * warnings collected during install.
 *
 * On failure, callers receive the structured failure plus the result
 * of the rollback attempt — view layers distinguish "clean abort" from
 * "partial rollback failure" by inspecting `rollback.ok`.
 */
export type RunInstallResult =
  | {
      ok: true
      lockfile: Lockfile
      summary: InstallSummary
      perFacet: ReadonlyArray<FacetOutcome>
      serverWarnings: ReadonlyArray<{ facet: string; servers: ReadonlyArray<string> }>
    }
  | {
      ok: false
      failure: RunInstallFailure
      rollback: { ok: true } | { ok: false; partialFailures: number }
    }

/**
 * Options for `runInstall`.
 *
 *   - `projectRoot`: absolute path to the project root. The function
 *     never reads `process.cwd()`.
 *   - `adapters`: install-capable adapters the project has selected.
 *     Caller is responsible for selection (and for prompting on zero).
 *   - `onStage`: structured progress events for view layers.
 *   - `onLog`: optional verbose passthrough; receives free-form lines.
 *   - `signal`: aborts the install at the next safe checkpoint and
 *     triggers rollback. Replaces direct SIGINT handling so core never
 *     installs process-global signal handlers.
 *
 * The behavior is the same regardless of who's calling. If a lockfile
 * entry exists for a facet, its locked version is honored verbatim —
 * the manifest's range is not re-resolved. If no lockfile entry exists
 * (bootstrap case, or a newly-added manifest entry), the manifest
 * specifier is resolved fresh and added to the lockfile. Drift removal
 * always runs. The lockfile is always written.
 */
export interface RunInstallOptions {
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  onStage?: (event: StageEvent) => void
  onLog?: (line: string) => void
  signal?: AbortSignal
}
