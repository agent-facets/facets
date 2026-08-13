import type { Adapter, McpServerCapabilityFailure } from '@agent-facets/adapter'
import type { AssetType, NonEmptyArray, Scope, ValidationError } from '@agent-facets/common'
import type {
  CollisionGroup,
  IntegrityFailure,
  MaterializationDisposition,
  ProjectAssetOverride,
  ServerCollisionGroup,
  SupportedLockfile,
} from '@agent-facets/protocol'
import type { AdapterCompatibilityFailure } from '../adapters/api-compatibility.ts'
import type { McpUnsupportedAdapter } from '../adapters/mcp-support.ts'
import type { FailedBatch, FileRollbackOutcome } from '../fs/index.ts'
import type { UnsupportedManifestVersion } from '../manifest/project-files.ts'
import type { RegistryError } from '../registry/index.ts'
import type { ParseError, Source } from '../sources/facet/types.ts'
import type { AssetTakeoverResolver } from './asset-takeover.ts'
import type { MaterializationAliasProblem } from './commit/collision-plan.ts'
import type { CollisionResolver } from './commit/compose.ts'
import type { McpConsentPolicy, McpConsentRequest } from './mcp/consent.ts'
import type { McpDocumentOverlap } from './mcp/documents.ts'
import type { McpConfigurationOutcome, McpConsentRequestSummary, McpInstallOutcomes } from './mcp/outcomes.ts'
import type { McpContractViolation } from './mcp/prepare.ts'

/**
 * Which kind of contribution a materialization override names.
 *
 * Tagged rather than an `AssetType` widened with a `'server'` member: servers
 * occupy their own identity space and carry no asset type at all, so the
 * asset arm is the only one that can hold one. Every consumer that has to
 * name an override — a prune report, a frozen drift entry, a collision
 * location — needs exactly this distinction and nothing more.
 */
export type ContributionKind = { kind: 'asset'; assetType: AssetType } | { kind: 'mcp-server' }

/** One override, identified by the facet and authored contribution it names. */
export interface MaterializationOverrideRef {
  facet: string
  contribution: ContributionKind
  /** The AUTHORED name, which is what `facets.json` keys the override by. */
  authoredName: string
}

/**
 * An override naming a contribution the resolved facet no longer has.
 *
 * Reported, never fatal: an override is durable project intent, so it
 * survives a failed operation and is dropped only by a successful commit.
 */
export interface StaleMaterializationOverride extends MaterializationOverrideRef {
  disposition: ProjectAssetOverride
}

/**
 * One unresolved effective-name collision, from either identity space.
 *
 * Tagged rather than flattened into a single member shape: an asset claimant
 * has a scope, an asset type, and a materialization namespace, while a server
 * claimant has a declaration and a fingerprint. A union of those fields with
 * everything optional would let a renderer read a namespace off a server
 * group and print nothing where a reason belongs.
 */
export type MaterializationCollisionGroup =
  | { kind: 'asset'; group: CollisionGroup }
  | { kind: 'mcp-server'; group: ServerCollisionGroup }

declare const EFFECTIVE_NAME: unique symbol

/**
 * An asset name in the EFFECTIVE domain — the name a project materializes an
 * asset under, which is the name on disk.
 *
 * Branded because the authored and effective names are both plain strings of
 * the same grammar, so nothing structural distinguishes them. The receipt and
 * lockfile record AUTHORED names; adapters are addressed by EFFECTIVE ones.
 * Without the brand a `ReceiptAsset` is assignable to {@link AssetIdentity},
 * and handing one to a delete request compiles cleanly while addressing the
 * wrong file for every aliased asset.
 *
 * The brand exists only in the type system: at runtime this is a string.
 * Produce one with {@link assetIdentity}, never by casting at a call site.
 */
export type EffectiveAssetName = string & { readonly [EFFECTIVE_NAME]: true }

/**
 * The adapter-agnostic identity of a single asset: the triple that names it
 * for read, install, and delete.
 *
 * `name` is the EFFECTIVE name. Distinct from any lockfile asset entry on
 * purpose. Materialization, journal entries, and progress events need only
 * the identity, and typing them against a lockfile entry implied they cared
 * about per-file records or dispositions — which in turn invited reading
 * those fields off a value whose version was no longer known.
 */
export interface AssetIdentity {
  scope: Scope
  type: AssetType
  name: EffectiveAssetName
}

/**
 * The sole constructor for an {@link AssetIdentity}.
 *
 * Taking the effective name as an explicitly-named parameter is the whole
 * point: a caller holding an authored name has to notice it is passing the
 * wrong one. Every adapter request in this package flows through here.
 */
export function assetIdentity(scope: Scope, type: AssetType, effectiveName: string): AssetIdentity {
  return { scope, type, name: effectiveName as EffectiveAssetName }
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
 *   - `removed`: facet is no longer declared in `facets.json` and this
 *     machine's receipt tracked its materialization, so its ownership was
 *     reconciled — obsolete identities deleted, transferred ones retained.
 *   - `removed-untracked`: facet is no longer declared and only the lockfile
 *     recorded it. Its declaration is dropped from the project's files, but
 *     nothing on disk is deleted, because no receipt claim proves this machine
 *     wrote it. A separate outcome rather than a flag on `removed`: "removed"
 *     and "removed, but the files are still there" are different things to
 *     tell a user, and a boolean beside `removed` would let a caller render
 *     the first while meaning the second.
 */
export type FacetOutcome =
  | { kind: 'installed'; name: string; version: string }
  | { kind: 'updated'; name: string; oldVersion: string; newVersion: string }
  | { kind: 'repaired'; name: string; version: string }
  | { kind: 'unchanged'; name: string; version: string }
  | { kind: 'removed'; name: string; oldVersion: string }
  | { kind: 'removed-untracked'; name: string; oldVersion: string }

/**
 * Aggregate counts for the post-install summary line.
 *
 * Grouped by domain rather than flattened. Text assets and MCP configurations
 * are different work in different places, and a flat shape made one of them
 * the default: `totalAssets` beside the facet counts read as "everything this
 * run did", so a facet that configured three servers and wrote no file
 * summarized as nothing happening. Naming the domain forces every reader to
 * say which one it means.
 */
export interface InstallSummary {
  /** Per-facet outcomes, counted by kind. `removed` includes untracked removals. */
  facets: {
    installed: number
    updated: number
    repaired: number
    unchanged: number
    removed: number
  }
  /**
   * Files. Counted per adapter and asset, so one skill across three adapters
   * is three writes — the same unit the adapters actually worked in.
   */
  textAssets: {
    /** Assets actually written (excludes skipped no-ops). */
    written: number
    removed: number
  }
  mcp: {
    /**
     * Native reconciliation, counted per adapter and effective identity —
     * the same unit as {@link textAssets}, for the same reason.
     */
    configurations: {
      added: number
      updated: number
      repaired: number
      unchanged: number
      removed: number
    }
    /** Authored declarations by disposition. Counted once, not per adapter. */
    declarations: {
      aliased: number
      omitted: number
    }
    /** Untracked native entries this run adopted or replaced with approval. */
    takeovers: {
      accepted: number
    }
  }
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
  /**
   * Composition is checking the complete desired set for cross-facet
   * collisions. Emitted once, between resolution and the first write, so the
   * step is visible rather than appearing as a stall.
   */
  | { kind: 'collision-check' }
  | { kind: 'facet-start'; facet: string; specifier: string }
  | { kind: 'facet-stage'; facet: string; stage: FacetStage }
  | { kind: 'facet-success'; facet: string; outcome: FacetOutcome }
  | { kind: 'facet-failure'; facet: string; failure: RunInstallFailure }
  | { kind: 'drift-removal'; facet: string; oldVersion: string }
  /**
   * A receipt asset entry was rejected during load (path traversal,
   * backslashes). The entry is skipped — never deleted on the
   * receipt's say-so — while the rest of the receipt is processed.
   */
  | { kind: 'receipt-invalid-asset'; facet: string; asset: string; reason: string }
  /**
   * A receipt MCP configuration claim was rejected during load (malformed
   * server name or fingerprint, or two conflicting claims for one server).
   * The claim is dropped, so its native entry reverts to untracked occupancy
   * and its declaration needs approval again — neither of which a user could
   * deduce from a run that otherwise looks routine.
   */
  | { kind: 'receipt-invalid-configuration'; facet: string; server: string; reason: string }
  /**
   * A receipt file exists for this project but could not be used — unreadable,
   * or self-identifying as a different project. Every identity it had tracked
   * is therefore untracked for this run: nothing can be cleaned up, and this
   * run's record starts from what it writes.
   *
   * Emitted only for `corrupt` and `path-mismatch`. A `missing` receipt is the
   * normal first-operation state and is not worth a warning.
   */
  | { kind: 'receipt-unavailable'; reason: 'corrupt' | 'path-mismatch' }
  /**
   * Assets were materialized, but the receipt recording them could not be
   * written. Only a frozen run reaches this: it has no locked set to roll
   * back, so it reports success while everything it just wrote stays
   * untracked. Surfaced without `--verbose` for the same reason
   * `receipt-unavailable` is — a silent success that quietly gives up
   * deletion authority is the one outcome a user cannot deduce later.
   *
   * `residue` is what the attempt to write it left behind. Usually nothing;
   * when the write landed and then could not be undone, the paths involved,
   * because a success that leaves a file it could not put back still owes the
   * user those paths.
   */
  | { kind: 'receipt-unpersisted'; cause: string; residue: FileRollbackOutcome }
  /**
   * A removal could not be answered from local state and fell back to
   * ordinary resolution. `reason` is the gate that refused, verbatim.
   *
   * Carried so a failure downstream can be explained. A removal that has to
   * resolve will name an unrelated facet — one the user is KEEPING — in its
   * error, and without this the connection between "I asked to remove X" and
   * "fetching Y failed" is invisible.
   */
  | { kind: 'removal-resolution-required'; reason: string }
  /**
   * A materialization override was dropped because the resolved facet version
   * no longer contains the asset or server it named.
   *
   * A dedicated event rather than a verbose log line: this silently changes
   * what `facets.json` says, so a user who never passes `--verbose` still has
   * to be told. Emitted only after the transaction commits — the prune is not
   * real until then.
   */
  | ({ kind: 'stale-override-pruned' } & MaterializationOverrideRef)
  /**
   * MCP configuration needs approval, and this run is about to ask for it.
   *
   * Carries the summary rather than the request: the exact declarations go to
   * the approval surface, which is the one place whose purpose is showing them.
   * A progress event describes what is being decided, not its payload.
   */
  | { kind: 'mcp-consent-required'; request: McpConsentRequestSummary }
  /**
   * Approval was obtained. `via` separates a human who read the commands from
   * a flag that stood in for one — the same set of work, authorized two
   * materially different ways.
   */
  | { kind: 'mcp-consent-accepted'; via: 'interactive' | 'preapproved' }
  /**
   * The user refused. Emitted before the journal opens, so nothing needs
   * undoing and the operation ends with every file as it was.
   */
  | { kind: 'mcp-consent-declined' }
  /**
   * An asset write reached an occupied destination this machine does not own,
   * and the just-in-time gate is about to ask about it.
   */
  | {
      kind: 'asset-takeover-required'
      facet: string
      adapter: string
      asset: AssetIdentity
      occupancy: 'equivalent' | 'divergent'
    }
  /** The occupied destination was adopted or overwritten. */
  | { kind: 'asset-takeover-accepted'; facet: string; adapter: string; asset: AssetIdentity }
  /** The user refused mid-application; the caller rolls the journal back. */
  | { kind: 'asset-takeover-cancelled'; facet: string; adapter: string; asset: AssetIdentity }
  /**
   * One effective MCP identity was reconciled into one adapter's native
   * configuration.
   *
   * Emitted only after the transaction commits, like `stale-override-pruned`
   * and for the same reason: until the tri-write succeeds the write is still
   * a candidate for rollback, and reporting it earlier would announce work
   * that may be undone a moment later.
   */
  | { kind: 'mcp-configured'; outcome: McpConfigurationOutcome }
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
   * The manifest's materialization intent for an asset disagrees with the
   * disposition the lockfile recorded. Reproducing recorded state cannot also
   * apply a new decision, so frozen mode refuses rather than picking one.
   */
  | {
      name: string
      reason: 'materialization-drift'
      assetType: AssetType
      authoredName: string
      manifest: MaterializationDisposition
      locked: MaterializationDisposition
    }
  /**
   * An override names an asset or server the locked content does not contain.
   * A normal install prunes it inside its transaction; frozen mode writes
   * nothing, so it can only report it.
   */
  | { name: string; reason: 'stale-override'; contribution: ContributionKind; authoredName: string }
  /**
   * The manifest records materialization intent the loaded lockfile format
   * cannot express. Reproduction would have to invent the missing half.
   */
  | { name: string; reason: 'materialization-unrepresentable'; lockfileVersion: number; requiredVersion: number }

/**
 * What a batch of file changes was for.
 *
 * The transaction itself understands only files, which is what makes it
 * reusable — but a user reading a failure needs to know whether the file that
 * would not budge was an asset, a tool's configuration, or the project's own
 * bookkeeping. That context travels here rather than being reconstructed from
 * a path.
 */
export type TransactionSubject =
  | { kind: 'asset'; facet: string; adapter: string; asset: AssetIdentity }
  | { kind: 'mcp'; adapter: string }
  | { kind: 'project-files' }

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
  | ({ code: 'FACETS_JSON_UNSUPPORTED_VERSION' } & UnsupportedManifestVersion)
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
   * A planned file change was refused or could not be applied.
   *
   * One code for every kind of file this system writes — assets, native
   * configuration documents, and the project's own manifest, lockfile, and
   * receipt — because the reasons are the same in each case: the file drifted
   * after the plan was computed, something that is not a plain file occupies
   * the path, or a syscall failed. `subject` names what the change was for so
   * a report can be specific without the failure shape being duplicated three
   * times.
   *
   * `batch` carries the failure AND, when the batch aborted, what its own
   * immediate unwind achieved. That unwind is never journaled — an aborted
   * batch merges nothing — so this is the only account of those paths that
   * will ever exist, and dropping it is how a run ends up reporting a clean
   * rollback over a file it left changed.
   */
  | {
      code: 'FILESYSTEM_TRANSACTION_FAILED'
      subject: TransactionSubject
      batch: FailedBatch
    }
  /** The adapter's read-only planning reported a structured failure. */
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
  /**
   * A persisted or resolver-supplied alias does not satisfy the asset-name
   * grammar. Distinct from a collision: the input cannot be interpreted at
   * all, so no effective set — and therefore no collision report — can be
   * derived from it.
   */
  | { code: 'MATERIALIZATION_ALIAS_INVALID'; problems: ReadonlyArray<MaterializationAliasProblem> }
  /**
   * Two or more assets claim one logical materialized identity and nothing
   * resolved it: frozen mode (which reproduces recorded intent and never
   * collects new decisions) or a non-interactive command with no resolver.
   *
   * Carries EVERY group, not the first — a user marched through repeated
   * attempts to discover one conflict at a time learns nothing about the
   * shape of the problem. Stale overrides ride along because they are a
   * diagnostic about intent, orthogonal to whether the set collides.
   */
  | {
      code: 'MATERIALIZATION_COLLISION'
      groups: ReadonlyArray<MaterializationCollisionGroup>
      staleOverrides: ReadonlyArray<StaleMaterializationOverride>
    }
  /**
   * An interactive resolver returned choices that still do not compose. The
   * resolver is not reopened automatically; the operation fails with what
   * the final validation found.
   */
  | {
      code: 'MATERIALIZATION_RESOLUTION_INVALID'
      groups: ReadonlyArray<MaterializationCollisionGroup>
      problems: ReadonlyArray<MaterializationAliasProblem>
    }
  /** The user dismissed collision resolution. No state was mutated. */
  | { code: 'MATERIALIZATION_CANCELLED' }
  /**
   * The user declined to take over an occupied destination this machine does
   * not own.
   *
   * Distinct from `MATERIALIZATION_CANCELLED`, which settles before the
   * journal opens and has nothing to undo. This one lands mid-application, so
   * the rollback outcome is the load-bearing half of the report: whether the
   * work already done was fully restored.
   */
  | { code: 'ASSET_TAKEOVER_CANCELLED'; facet: string; adapter: string; asset: AssetIdentity }
  /**
   * This operation has MCP configuration work — an active declaration to
   * reconcile, or a receipt-owned entry to remove — and at least one selected
   * adapter cannot do it.
   *
   * Raised after composition (which is what makes the active set knowable)
   * and before preparation, consent, or any mutation. Carries every
   * unsupported adapter, because upgrading one at a time to discover the next
   * teaches a user nothing about the shape of the problem, and the effective
   * server names so the remedy can point at the declarations to omit. It
   * deliberately carries no declaration: neither remedy needs the command a
   * server would run.
   */
  | {
      code: 'MCP_ADAPTERS_UNSUPPORTED'
      adapters: ReadonlyArray<McpUnsupportedAdapter>
      servers: ReadonlyArray<string>
    }
  /**
   * An adapter's read-only MCP preparation reported a structured failure —
   * an unparseable or unsafely-shaped native document, or a read it could not
   * perform. Preparation writes nothing, so every inspected document is
   * unchanged.
   */
  | { code: 'MCP_PREPARE_FAILED'; adapter: string; failure: McpServerCapabilityFailure }
  /**
   * Re-planning an adapter's MCP change immediately before committing it
   * reported a structured failure. Nothing of this adapter's was written;
   * every earlier document this run changed is restored from its exact prior
   * bytes.
   */
  | { code: 'MCP_APPLY_FAILED'; adapter: string; failure: McpServerCapabilityFailure }
  /**
   * An adapter broke the MCP capability contract in a way that would make
   * rollback unsound. Distinct from `MCP_PREPARE_FAILED`: the fault is in the
   * adapter, not in the project's configuration, and no user edit fixes it.
   */
  | { code: 'MCP_CONTRACT_VIOLATION'; violation: McpContractViolation }
  /**
   * Two or more selected adapters reconcile the same native document.
   *
   * Neither ordering works: each plans against a document the other rewrites,
   * so whichever writes second applies a plan computed from bytes that are
   * gone. Raised before approval and before any mutation, and carrying every
   * group so the remedy can be decided once.
   */
  | { code: 'MCP_DOCUMENT_OVERLAP'; overlaps: NonEmptyArray<McpDocumentOverlap> }
  /**
   * Re-planning immediately before the write reached a different conclusion
   * about what this run does.
   *
   * Not an adapter fault: it read its document again and reported what it
   * found. Something outside this run changed that document — plausibly while
   * the approval prompt was open — so what would be written is no longer what
   * was approved. Nothing of this adapter's was written.
   */
  | { code: 'MCP_NATIVE_STATE_DRIFT'; adapter: string; documents: ReadonlyArray<string> }
  /**
   * MCP configuration needs approval and this caller cannot give it: a
   * non-interactive command without `--accept-mcp`, or frozen mode, which
   * reproduces recorded intent and never collects a new decision.
   *
   * Carries the complete request because the remedy is to read it: a user
   * deciding whether to pass `--accept-mcp` needs the exact commands and URLs
   * it would authorize. Raised before the journal opens, so nothing changed.
   */
  | { code: 'MCP_CONSENT_REQUIRED'; request: McpConsentRequest }
  /**
   * The user declined the MCP configuration request.
   *
   * Carries the SUMMARY, not the request: the user just read the declarations
   * and said no, so reprinting them helps nobody, while the identities are
   * what a report needs to say which servers were left unconfigured. Nothing
   * was mutated — consent settles before the journal opens.
   */
  | { code: 'MCP_CONSENT_DECLINED'; request: McpConsentRequestSummary }
  | { code: 'ABORTED' }

/**
 * Why an operation had nothing to undo.
 *
 * A closed set rather than a sentence: the two cases mean different things to
 * a user — one failed before the run could touch anything, the other failed
 * after acquiring the lock but before the first mutation — and a free-form
 * string is something no view layer can branch on.
 */
export type NoMutationReason = 'pre-lock' | 'post-lock-no-mutation'

/**
 * What a failed run left on disk.
 *
 * `not-needed` is this system's own arm; the other two come from the
 * filesystem transaction unchanged, so what the CLI reports about a rollback
 * is exactly what the transaction observed rather than a lossy re-encoding of
 * it. `incomplete` carries at least one issue by type, so "something is still
 * out there" cannot be reported with nothing out there.
 */
export type RollbackOutcome = { kind: 'not-needed'; reason: NoMutationReason } | FileRollbackOutcome

/**
 * Result of a `runInstall` invocation. Discriminated by `ok`.
 *
 * On success, callers receive the new lockfile (already written to
 * disk), a summary of counts, per-facet outcomes, and what the run did
 * to this project's MCP configuration.
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
      /**
       * What this operation did to MCP configuration: intent, native
       * reconciliation, and the approval that authorized it.
       */
      mcp: McpInstallOutcomes
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
  /**
   * Optional interactive collision resolver.
   *
   * Omitted by every non-interactive caller, which is what makes
   * "fail with the complete report" the default rather than a special case.
   * Frozen mode ignores it: reproducing recorded intent must never collect
   * new decisions.
   */
  resolveCollisions?: CollisionResolver
  /**
   * How this invocation may obtain MCP configuration approval.
   *
   * Defaults to `unavailable`, which makes "fail with the complete request"
   * the default rather than a special case — the same discipline that makes
   * an omitted `resolveCollisions` report instead of guess. Frozen mode may
   * use `preapproved` but never `interactive`.
   */
  mcpConsent?: McpConsentPolicy
  /**
   * Optional just-in-time gate for an occupied asset destination this machine
   * does not own.
   *
   * Note the deliberate asymmetry with `resolveCollisions`: an absent
   * collision resolver FAILS, because a collision has no correct answer
   * without the user. An absent takeover resolver CONTINUES, because a
   * takeover does — the behavior every non-interactive caller has today.
   *
   * Independent of `mcpConsent` by construction. Approving a server's command
   * must never be the act that also accepts overwriting a file.
   */
  resolveAssetTakeover?: AssetTakeoverResolver
}
