import type { Adapter } from '@agent-facets/adapter'
import type { AssetType, Scope, ValidationError } from '@agent-facets/common'
import type { IntegrityFailure, SupportedLockfile } from '@agent-facets/protocol'
import type { AdapterCompatibilityFailure } from '../adapters/api-compatibility.ts'
import type { RegistryError } from '../registry/index.ts'
import type { ParseError, Source } from '../sources/facet/types.ts'

/**
 * The adapter-agnostic identity of a single asset: the triple that names it
 * for read, install, and delete.
 *
 * Distinct from any lockfile asset entry on purpose. Materialization,
 * journal entries, and progress events need only the identity, and typing
 * them against a lockfile entry implied they cared about per-file records or
 * dispositions — which in turn invited reading those fields off a value
 * whose version was no longer known.
 */
export interface AssetIdentity {
  scope: Scope
  type: AssetType
  name: string
}

/**
 * An asset previously materialized on this machine: its identity plus every
 * inner-archive path it owns, primary included.
 *
 * Callers normalize into this shape before handing it to materialization.
 * Previous ownership can arrive from a lockfile entry (`{ path, integrity }`
 * records, or none at all on a legacy entry) or from the receipt (bare path
 * strings), and materialization used to accept whichever it was given and
 * probe for `files` structurally. Normalizing at the boundary means the
 * shape question is answered once, by the code that knows the answer.
 */
export interface MaterializedAssetOwnership extends AssetIdentity {
  ownedPaths: readonly string[]
}

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
 * Verbose-log sink. Accepts a lazy builder (thunk) that produces a single,
 * fully-formatted line. The thunk is only invoked when the sink is active,
 * so template interpolation and conditional concatenation are skipped
 * entirely when `--verbose` is off and `onLog` is undefined.
 *
 * The builder should return a line following these conventions:
 *
 *   - prefix `[verbose] ` (diagnostics) or `[warn] ` (non-fatal)
 *   - top-level operations: one space after prefix (`[verbose] …`)
 *   - per-facet / per-asset detail: three spaces (`[verbose]   …`)
 *   - asset sigils: `+` new / `~` repaired/updated / `-` deleted / `=` unchanged
 *   - `→` (U+2192) separates source → destination
 */
export type OnLog = (build: () => string) => void

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
  /**
   * A receipt asset entry was rejected during load (path traversal,
   * backslashes). The entry is skipped — never deleted on the
   * receipt's say-so — while the rest of the receipt is processed.
   */
  | { kind: 'receipt-invalid-asset'; facet: string; asset: string; reason: string }
  | { kind: 'adapter-complete'; facet: string; adapter: string }
  | { kind: 'asset-installed'; facet: string; adapter: string; asset: AssetIdentity }
  | { kind: 'asset-deleted'; facet: string; adapter: string; asset: AssetIdentity }
  | { kind: 'lockfile-write'; path: string }
  | { kind: 'install-complete'; outcome: 'success' | 'failure' | 'aborted' }

/**
 * One drifting facet in a frozen-lockfile (`--frozen-lockfile`) preflight
 * failure. Tagged on `reason` so each arm carries exactly the fields that
 * reason implies — no optional field doubles as a discriminator:
 *   - `missing-lockfile` — no lockfile exists at all; only the spec is known.
 *   - `no-entry`         — the manifest declares a facet the lockfile omits.
 *   - `unsatisfied`      — the locked version does not satisfy the spec;
 *                          always carries the offending `lockedVersion`.
 *   - `orphaned`         — the lockfile pins a facet the manifest no longer
 *                          declares; carries `lockedVersion` but no
 *                          `manifestSpec` (the manifest says nothing about it).
 *   - `source-changed`   — a git/local facet whose manifest source string
 *                          (URL/ref/path) no longer matches the locked
 *                          source; carries both so the user sees the swap.
 *                          Registry version drift is reported as
 *                          `unsatisfied`, not here.
 */
export type LockfileDriftEntry =
  | { name: string; reason: 'missing-lockfile'; manifestSpec: string }
  | { name: string; reason: 'no-entry'; manifestSpec: string }
  | { name: string; reason: 'unsatisfied'; manifestSpec: string; lockedVersion: string }
  | { name: string; reason: 'orphaned'; lockedVersion: string }
  | { name: string; reason: 'source-changed'; manifestSpec: string; lockedSource: string }

/**
 * Discriminated failure type for `runInstall`. Every failure mode
 * carries the structured fields a view layer needs to render the
 * failure without parsing message strings.
 */
export type RunInstallFailure =
  | { code: 'FACETS_JSON_NOT_FOUND'; path: string }
  | { code: 'FACETS_JSON_INVALID'; path: string; error: string }
  /**
   * The manifest declares a `manifestVersion` this CLI cannot read. Kept
   * distinct from `FACETS_JSON_INVALID` because the remedy is different —
   * upgrade the CLI, rather than fix the document — and because the observed
   * and supported versions must reach the view as data, not prose.
   */
  | {
      code: 'FACETS_JSON_UNSUPPORTED_VERSION'
      path: string
      observed: number | undefined
      supported: readonly number[]
    }
  | { code: 'LOCKFILE_INVALID'; path: string; error: string }
  | { code: 'LOCKFILE_WRITE_FAILED'; path: string; cause: string }
  | { code: 'LOCK_HELD'; path: string; heldByPid: number }
  | { code: 'PARSE_ERROR'; facet: string; specifier: string; error: ParseError }
  | { code: 'REGISTRY_ERROR'; facet: string; error: RegistryError }
  /**
   * A registry lockfile entry was about to be created or replaced, the
   * content was already on hand (warm cache), but the registry could not
   * be reached for integrity confirmation. Distinct from
   * `REGISTRY_ERROR`: nothing needed downloading — the ONLY missing
   * piece was the registry's published fingerprint, and a lockfile entry
   * is never written on trust (design D3). The commit fails closed with
   * the project unchanged.
   */
  | { code: 'CONFIRMATION_UNAVAILABLE'; facet: string; version: string; error: RegistryError }
  | { code: 'INTEGRITY_FAILURE'; failure: IntegrityFailure }
  | {
      code: 'CACHE_INTEGRITY_MISMATCH'
      facet: string
      slotPath: string
      cachedIntegrity: string
      lockedIntegrity: string
    }
  | { code: 'COMPOSITION_REJECTED'; facet: string }
  /**
   * Frozen-lockfile mode (`--frozen-lockfile`) found the lockfile out of
   * date relative to the manifest. Carries every drifting facet (see
   * `LockfileDriftEntry` for the per-reason shape) so the CLI can render a
   * complete report in one shot. No mutation occurs; the user must
   * reconcile the files (run a normal install, or `facet add` to update
   * the lockfile).
   */
  | {
      code: 'LOCKFILE_DRIFT'
      facets: ReadonlyArray<LockfileDriftEntry>
    }
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
  /**
   * `git clone` succeeded but `git rev-parse HEAD` produced no commit, so
   * the source can't be pinned. A git lockfile entry requires a commit
   * (it's the reproducible identity), so this fails the install rather
   * than writing a commitless entry.
   */
  | { code: 'GIT_COMMIT_UNRESOLVED'; facet: string; url: string; stderr: string }
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
   * A selected adapter does not declare a CLI-supported adapter API.
   * Detected by the preflight before the per-facet loop (which precedes
   * any Git/local facet build, materialization write, or adapter
   * contract method) — the primary gate is the command-level
   * fail-closed load; this is defense-in-depth. Carries every
   * incompatible adapter, not just the first.
   */
  | { code: 'ADAPTER_INCOMPATIBLE'; failures: ReadonlyArray<AdapterCompatibilityFailure> }
  /**
   * `adapter.readAsset` threw something other than ENOENT. The asset's
   * pre-install state is unknown, so we abort before writing rather
   * than risk a delete-undo on an asset we can't observe.
   */
  | {
      code: 'ADAPTER_READ_FAILED'
      facet: string
      adapter: string
      asset: AssetIdentity
      cause: string
    }
  /** `adapter.installAsset` threw. */
  | {
      code: 'ADAPTER_INSTALL_FAILED'
      facet: string
      adapter: string
      asset: AssetIdentity
      cause: string
    }
  /** `adapter.deleteAsset` threw during drift removal. */
  | {
      code: 'ADAPTER_DELETE_FAILED'
      facet: string
      adapter: string
      asset: AssetIdentity
      cause: string
    }
  | { code: 'FROZEN_WITH_DELTA' }
  /**
   * The install delta contains the same facet name in both `additions`
   * and `removals`. This is an illegal state the CLI should never
   * produce; the check exists as defense-in-depth.
   */
  | { code: 'DELTA_CONFLICT'; facet: string }
  /**
   * Pre-materialization reconciliation (design D10, task 9.3) found the
   * `0.2` lockfile entry disagreeing with the freshly-derived verified
   * asset plan. Every variant is path- or identity-specific so the CLI can
   * name the exact divergence without parsing a message. Reconciliation
   * runs BEFORE any adapter write, so a mismatch leaves all state
   * untouched.
   *
   *   - `facet-integrity` — the locked facet-level integrity does not equal
   *     the recomputed archive integrity for this resolved artifact.
   *   - `asset-identity`  — the locked asset identity set (scope:type:name)
   *     differs from the verified plan's; `missing` is locked-not-planned,
   *     `unexpected` is planned-not-locked.
   *   - `owned-path-set`  — an asset's locked file-path set differs from the
   *     plan's owned paths for that asset; carries the differing path.
   *   - `per-file-integrity` — a locked per-file hash does not equal the
   *     recomputed archive-entry hash for that exact path.
   */
  | { code: 'RECONCILE_FACET_INTEGRITY'; facet: string; expected: string; actual: string }
  | {
      code: 'RECONCILE_ASSET_IDENTITY'
      facet: string
      missing: ReadonlyArray<string>
      unexpected: ReadonlyArray<string>
    }
  | {
      code: 'RECONCILE_OWNED_PATH_SET'
      facet: string
      asset: string
      missing: ReadonlyArray<string>
      unexpected: ReadonlyArray<string>
    }
  | {
      code: 'RECONCILE_PER_FILE_INTEGRITY'
      facet: string
      asset: string
      path: string
      expected: string
      actual: string
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
      lockfile: SupportedLockfile
      summary: InstallSummary
      perFacet: ReadonlyArray<FacetOutcome>
      serverWarnings: ReadonlyArray<{ facet: string; servers: ReadonlyArray<string> }>
    }
  | {
      ok: false
      failure: RunInstallFailure
      rollback: RollbackOutcome
    }

// ---------------------------------------------------------------------------
// Install delta — the plan phase's output, the commit phase's input
// ---------------------------------------------------------------------------

/**
 * A facet the user explicitly asked to add. The specifier is carried
 * verbatim so commit can apply the manifest-write policy (bare → pin;
 * explicit → verbatim) and the structural discriminator (additions
 * never trust the lockfile for version resolution).
 */
export interface Addition {
  facetName: string
  /** The raw specifier string as the user typed it (e.g. `cowsay@0.*`). */
  specifier: string
  /** The parsed source — already resolved from the specifier. */
  source: Source
}

/**
 * A facet the user explicitly asked to remove.
 */
export interface Removal {
  facetName: string
}

/**
 * The delta produced by the plan phase. `facet install` produces an
 * empty delta; `facet add` populates `additions`; `facet remove`
 * populates `removals`. Same-name in both is an illegal state the
 * CLI cannot produce; `runInstall` validates it at the top.
 */
export interface InstallDelta {
  additions: ReadonlyArray<Addition>
  removals: ReadonlyArray<Removal>
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
 *   - `frozenLockfile`: treat the lockfile as the source of truth.
 *     Specifiers are never re-resolved, the lockfile is never written,
 *     and any manifest/lockfile drift (missing lockfile, an uncovered
 *     manifest entry, or a locked version that does not satisfy its
 *     specifier) fails with `LOCKFILE_DRIFT` before any disk mutation.
 *     Mirrors the ecosystem-standard `--frozen-lockfile` CI contract.
 *
 * The behavior is the same regardless of who's calling. If a lockfile
 * entry exists for a facet AND its locked version satisfies the
 * manifest specifier, that locked version is honored verbatim — the
 * manifest's range is not re-resolved. If the locked version does NOT
 * satisfy the manifest specifier (a hand-edit or pull changed the
 * manifest), the entry is stale: the manifest specifier is re-resolved
 * and the stale entry is overwritten. If no lockfile entry exists
 * (bootstrap case, or a newly-added manifest entry), the manifest
 * specifier is resolved fresh and added to the lockfile. Drift removal
 * always runs. The lockfile is always written — except in
 * frozen-lockfile mode (see `frozenLockfile`), where it is never
 * written and any manifest/lockfile drift is a hard error.
 */
export interface RunInstallOptions {
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  /** Explicit additions/removals from the plan phase. Omit or pass
   *  `{ additions: [], removals: [] }` for a plain `facet install`. */
  delta?: InstallDelta
  onStage?: (event: StageEvent) => void
  onLog?: OnLog
  signal?: AbortSignal
  frozenLockfile?: boolean
}
