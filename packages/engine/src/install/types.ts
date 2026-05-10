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
  /** `git` is not installed (or not on PATH). */
  | { code: 'GIT_BINARY_MISSING'; facet: string }
  /**
   * `git clone` failed because the registry rejected our auth attempt.
   * Closed alpha supports public repos and SSH (via agent) only.
   */
  | { code: 'GIT_AUTH_REQUIRED'; facet: string; url: string }
  /**
   * `git clone` failed for a reason other than missing-binary or
   * auth-required (network, ref-not-found, generic). Carries stderr
   * verbatim for the CLI to surface.
   */
  | { code: 'GIT_CLONE_FAILED'; facet: string; url: string; stderr: string }
  /** `git checkout <commit>` failed after a successful clone. */
  | {
      code: 'GIT_CHECKOUT_FAILED'
      facet: string
      url: string
      commitish: string
      stderr: string
    }
  | { code: 'LOCAL_RESOLVE_FAILED'; facet: string; cause: string }
  | { code: 'BUILD_FAILED'; facet: string; errors: ReadonlyArray<ValidationError> }
  | { code: 'MANIFEST_NAME_MISMATCH'; facet: string; manifestName: string }
  | { code: 'MANIFEST_LOAD_FAILED'; facet: string; errors: ReadonlyArray<ValidationError> }
  /**
   * The selected adapter has `supportsInstall !== true`. Defense-in-depth
   * beyond the picker filter — fail loud rather than silently no-op.
   */
  | { code: 'ADAPTER_UNSUPPORTED'; facet: string; adapter: string }
  /**
   * `adapter.readAsset` threw something other than ENOENT. The asset's
   * pre-install state is unknown, so we abort before writing rather
   * than risk a delete-undo on an asset we can't observe.
   */
  | {
      code: 'ADAPTER_READ_FAILED'
      facet: string
      adapter: string
      asset: LockfileAssetEntry
      cause: string
    }
  /** `adapter.installAsset` threw. */
  | {
      code: 'ADAPTER_INSTALL_FAILED'
      facet: string
      adapter: string
      asset: LockfileAssetEntry
      cause: string
    }
  /** `adapter.deleteAsset` threw during drift removal. */
  | {
      code: 'ADAPTER_DELETE_FAILED'
      facet: string
      adapter: string
      asset: LockfileAssetEntry
      cause: string
    }
  | { code: 'ABORTED' }

/**
 * Outcome of the rollback step on a failed install. Three semantically
 * distinct arms encoded explicitly so view layers can render each
 * differently — pre-#9 these all collapsed into `{ ok: true }` and the
 * "we rolled back N entries" information was lost across the boundary.
 *
 *   - `not-needed` — no rollback was attempted because there was
 *     nothing to undo. The `reason` string distinguishes pre-lock
 *     failures (failed before acquiring the install lock; e.g.
 *     `facets.json` missing) from post-lock-no-mutation failures
 *     (lock acquired but no journal entries recorded yet). Default
 *     rendering can collapse both to "no rollback needed"; verbose
 *     mode can surface the distinction.
 *   - `succeeded` — a real rollback ran and replayed every recorded
 *     journal entry in reverse. `entriesUndone` counts them.
 *   - `partial-failure` — the rollback ran but at least one inverse
 *     op threw. `entriesUndone` is the count that successfully
 *     replayed; `failures` is the count that didn't. View layers
 *     surface this as the canonical "manual cleanup may be needed"
 *     message.
 */
export type RollbackOutcome =
  | { kind: 'not-needed'; reason: string }
  | { kind: 'succeeded'; entriesUndone: number }
  | { kind: 'partial-failure'; entriesUndone: number; failures: number }

/**
 * Result of a `runInstall` invocation. Discriminated by `ok`.
 *
 * On success, callers receive the new lockfile (already written to
 * disk), a summary of counts, per-facet outcomes, and any server
 * warnings collected during install.
 *
 * On failure, callers receive the structured failure plus the
 * `RollbackOutcome` — view layers branch on `rollback.kind`.
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
      rollback: RollbackOutcome
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
