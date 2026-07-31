import type {
  Adapter,
  AdapterAssetFailure,
  CompanionMap,
  DeleteAssetRequest,
  InstallAssetRequest,
  ReadAssetRequest,
} from '@agent-facets/adapter'
import { type Scope, splitFrontMatter } from '@agent-facets/common'
import { type MaterializedAsset, type ResolvedFacetManifest, skillRootPath } from '@agent-facets/protocol'
import { type AdapterCompatibilityFailure, compatibilityFailureFor } from '../adapters/api-compatibility.ts'
import { ownedCompanionPathsFor, type PreviousOwnership } from './commit/ownership.ts'
import type { InstallJournal } from './journal.ts'
import { type AssetIdentity, assetIdentity, type OnLog, type StageEvent } from './types.ts'
import { authoredCompanionKey, type SkillCompanionBytes } from './verified-asset-plan.ts'

export interface MaterializeOptions {
  /** Facet name — used to tag per-adapter progress events. */
  facetName: string
  manifest: ResolvedFacetManifest
  /** Adapters already filtered to those with supportsInstall === true. */
  adapters: Adapter[]
  /**
   * The assets to write, carrying both identities: the authored name that
   * anchors content, description, adapter extras, and companion bytes, and
   * the effective name the adapter is addressed with.
   *
   * Omitted assets never appear here — composition excluded them.
   */
  newAssets: readonly MaterializedAsset[]
  /**
   * The global previous-ownership index, keyed by effective adapter identity.
   * Supplies the owned companion paths a replacement write may remove, which
   * is a property of the identity being overwritten rather than of the facet
   * doing the overwriting.
   */
  previousOwnership: ReadonlyMap<string, PreviousOwnership>
  /**
   * Skill companion bytes for the assets being installed, keyed by AUTHORED
   * identity (from the resolver's verified asset plan). A missing entry or
   * map means "no companions" (single-file behavior).
   */
  companionBytes?: Map<string, SkillCompanionBytes>
  journal: InstallJournal
  onLog?: OnLog
  /** Structured progress events for view layers. */
  onStage?: (event: StageEvent) => void
}

/**
 * Outcome counts for one `materialize` call. Returned so the caller can
 * distinguish between "fully unchanged" (no writes) and "repaired"
 * (some assets needed to be re-written even though the facet's lockfile
 * entry didn't change — e.g., a user manually deleted the on-disk file).
 */
export interface MaterializeCounts {
  /** Assets actually written to an adapter. Excludes skipped no-ops. */
  written: number
  /** Assets skipped because content + metadata matched on disk. */
  skipped: number
}

/**
 * Discriminated failure for `materialize`. Each kind preserves the
 * adapter name (the smoking-gun problem with the previous throw-based
 * shape was the caller fabricating `'unknown'` as the adapter — the
 * info was right there but lost in the throw boundary).
 *
 *   - `unsupported-adapter` — caller passed an adapter whose
 *     `supportsInstall !== true`. Defense-in-depth beyond the picker
 *     filter; loud failure beats silent no-op.
 *   - `incompatible-adapter` — caller passed an adapter that does not
 *     declare a CLI-supported API. Invariant check only: the primary
 *     gates are the command-level fail-closed load and the runInstall
 *     preflight; reaching this arm means an upstream gate was bypassed.
 *   - `read-failed` — `adapter.readAsset` returned a failure other than
 *     `not-found` (or threw, which is an adapter bug). `not-found` is
 *     the one "asset didn't exist" signal we trust; anything else means
 *     we don't know whether the asset existed, so the journal must not
 *     record a delete-undo based on an assumption of absence.
 *   - `install-failed` — `adapter.installAsset` returned a failure or threw.
 *   - `delete-failed` — `adapter.deleteAsset` returned a failure or threw.
 */
export type MaterializeFailure =
  | { kind: 'unsupported-adapter'; adapter: string }
  | { kind: 'incompatible-adapter'; failure: AdapterCompatibilityFailure }
  | { kind: 'read-failed'; adapter: string; asset: AssetIdentity; cause: string }
  | { kind: 'install-failed'; adapter: string; asset: AssetIdentity; cause: string }
  | { kind: 'delete-failed'; adapter: string; asset: AssetIdentity; cause: string }

/**
 * Result of one `materialize` call. Errors are values, not control
 * flow — the caller pattern-matches on `failure.kind` and routes each
 * to the matching `RunInstallFailure` code (`ADAPTER_UNSUPPORTED`,
 * `ADAPTER_READ_FAILED`, `ADAPTER_INSTALL_FAILED`, `ADAPTER_DELETE_FAILED`).
 */
export type MaterializeResult = ({ ok: true } & MaterializeCounts) | { ok: false; failure: MaterializeFailure }

/**
 * Apply the install + delete operations across all selected adapters and
 * record inverse operations on the journal so a rollback can replay them.
 *
 * Per-asset, before writing, the adapter's current on-disk content is
 * compared to what we would write (content + metadata as JSON). If
 * identical, the write is skipped and no journal entry is recorded —
 * the asset was already in its desired state, and there's nothing to
 * undo. The skip count is reported in the returned `MaterializeResult`
 * so the caller can label outcomes accurately ("repaired" vs.
 * "unchanged") in summaries.
 *
 * Returns a discriminated `MaterializeResult` — never throws on a
 * documented failure mode. The caller is responsible for driving
 * rollback via `journal.rollback()` and emitting the failure as a
 * `RunInstallFailure`.
 */
export async function materialize(opts: MaterializeOptions): Promise<MaterializeResult> {
  let written = 0
  let skipped = 0

  for (const adapter of opts.adapters) {
    // Adjustment S — runtime supportsInstall check (defense-in-depth beyond
    // the picker filter). Fail loud rather than silent no-op.
    if (adapter.supportsInstall !== true) {
      return { ok: false, failure: { kind: 'unsupported-adapter', adapter: adapter.name } }
    }

    // Invariant check only — the primary compatibility gates run at the
    // command level and in the runInstall preflight, both before any
    // materialization write. Reaching this arm means a gate was bypassed.
    const incompatibility = compatibilityFailureFor(adapter.name, adapter.apiVersion)
    if (incompatibility !== null) {
      return { ok: false, failure: { kind: 'incompatible-adapter', failure: incompatibility } }
    }

    opts.onLog?.(() => `[verbose]   installing ${opts.facetName}@${opts.manifest.version} → ${adapter.name}`)

    for (const asset of opts.newAssets) {
      const target = adapterTargetFor(asset)
      const content = contentFor(opts.manifest, asset)
      const metadata = buildAssetMetadata(opts.manifest, asset, adapter.name)
      // NEW companion bytes for this skill, keyed by AUTHORED identity (empty
      // for companion-less skills and non-skill assets); PREVIOUS owned paths
      // keyed by EFFECTIVE identity, so taking a name over from another facet
      // cleans up that facet's leftovers.
      const companions =
        opts.companionBytes?.get(authoredCompanionKey(asset.scope, asset.type, asset.authoredName)) ?? {}
      const ownedCompanionPaths = ownedCompanionPathsFor(opts.previousOwnership, asset)

      // Capture original state for rollback (F14). Treating any failure
      // as "didn't exist" would let the journal's delete-undo silently
      // delete a pre-existing asset we never read successfully. Narrow to
      // the structured `not-found` only and surface everything else as
      // `read-failed` — install fails loud before we write anything.
      const readOutcome = await readPrevious(adapter, target, ownedCompanionPaths)
      if (!readOutcome.ok) {
        return {
          ok: false,
          failure: { kind: 'read-failed', adapter: adapter.name, asset: target, cause: readOutcome.cause },
        }
      }
      const previous = readOutcome.previous

      // Skip-if-identical: when the on-disk content + metadata already
      // matches what we would write, no work is needed and no journal
      // entry is recorded (there's nothing to undo).
      //
      // The identity is still recorded as owned afterwards, including when
      // nothing on disk was tracked before. Ownership follows from having
      // RECONCILED the identity to the desired state, and a byte-for-byte
      // comparison establishes that as conclusively as a write does —
      // rewriting identical bytes would prove nothing the comparison has not.
      //
      // The candidate (`content`, `metadata`) we hand to `installAsset`
      // is NOT what lands on disk byte-for-byte. The adapter SDK's
      // `assembleAssetContent` splits any author-supplied front matter
      // out of `content` and merges it under the caller's `metadata`
      // (caller wins on key collisions), then re-emits a `--- yaml ---
      // body` file. To compare apples-to-apples with what `readAsset`
      // returns, we replay that merge here:
      //   - body is the post-split candidate body (via the same
      //     `splitFrontMatter` primitive the adapter SDK uses)
      //   - metadata is the same merge the SDK would do
      // The on-disk `previous.content` and `previous.metadata` reflect
      // that merged shape, so equality holds iff a no-op write is safe.
      //
      // We import `splitFrontMatter` from `common` rather than
      // `splitAssetContent` from the adapter SDK to keep the adapter SDK
      // a type-only dep of engine: a value import from the SDK pulls
      // `yaml` into engine's runtime graph and collides with `Bun.build`
      // when the CLI's adapter integration tests bundle the same source.
      const candidateSplit = splitFrontMatter(content)
      const mergedCandidateMetadata = { ...(candidateSplit.metadata ?? {}), ...metadata }
      // Skip only when the primary AND every companion already match on disk.
      // A single drifted companion (or a changed companion set) forces a
      // repair through the atomic bundle replacement below.
      if (
        previous &&
        previous.content === candidateSplit.content &&
        JSON.stringify(previous.metadata ?? {}) === JSON.stringify(mergedCandidateMetadata) &&
        companionsIdentical(previous.companions, companions)
      ) {
        opts.onLog?.(() => `[verbose]     =${describeTarget(asset)} (skipped)`)
        skipped++
        continue
      }

      // Sigil: `+` new asset (didn't exist before), `~` repaired/updated (existed but changed)
      const sigil = previous === null ? '+' : '~'

      // Path-specific drift reporting (design D10, task 9.7): when an existing
      // bundle is being repaired, name the exact companion paths that differ
      // (drifted, added, or removed) rather than only the owning asset. The
      // path is the one on disk, so it is rooted at the EFFECTIVE name.
      if (previous !== null && asset.type === 'skill') {
        for (const path of driftedCompanionPaths(previous.companions, companions)) {
          opts.onLog?.(
            () => `[verbose]     ~${describeTarget(asset)} drift: ${skillRootPath(asset.effectiveName)}${path}`,
          )
        }
      }

      let writtenPath: string | undefined
      try {
        const result = await adapter.installAsset(
          installRequestFor(target, content, metadata, companions, ownedCompanionPaths),
        )
        if (!result.ok) {
          return {
            ok: false,
            failure: {
              kind: 'install-failed',
              adapter: adapter.name,
              asset: target,
              cause: describeAssetFailure(result.failure),
            },
          }
        }
        writtenPath = result.primaryPath
      } catch (err) {
        return {
          ok: false,
          failure: {
            kind: 'install-failed',
            adapter: adapter.name,
            asset: target,
            cause: err instanceof Error ? err.message : String(err),
          },
        }
      }
      opts.onLog?.(() => `[verbose]     ${sigil}${describeTarget(asset)}${writtenPath ? ` → ${writtenPath}` : ''}`)
      written++

      // Rollback preimage: restore the COMPLETE prior bundle (primary +
      // previously-owned companion bytes), or delete a freshly-created asset.
      //
      // The owned set handed to the inverse op is the union of every path this
      // write could have touched: the paths it was allowed to REMOVE (the
      // receipt's owned set) and the paths it actually WROTE (the new
      // companions). The second half is load-bearing. An undo that named only
      // the prior owned set would restore the old primary while leaving every
      // companion this operation added on disk — stranded beside a bundle that
      // no longer references them, and permanently untracked, because a failed
      // transaction commits no receipt to claim them by.
      const touchedOwned = unionPaths(ownedCompanionPaths, Object.keys(companions))
      opts.journal.record({
        label: `install ${adapter.name}:${target.type}:${target.name}`,
        undo: async () => {
          if (previous) {
            await runUndoInstall(
              adapter,
              target,
              previous.content,
              previous.metadata ?? {},
              previous.companions,
              touchedOwned,
            )
          } else {
            await runUndoDelete(adapter, target, touchedOwned)
          }
        },
      })
    }

    opts.onStage?.({ kind: 'adapter-complete', facet: opts.facetName, adapter: adapter.name })
  }

  return { ok: true, written, skipped }
}

/**
 * The adapter-facing identity of a planned asset: its EFFECTIVE name.
 *
 * Every adapter request, journal label, and failure report addresses the file
 * on disk, which is named by the project's disposition — not by the
 * publisher. Content, description, adapter extras, companion bytes, and
 * integrity all stay authored and are looked up from `asset.authoredName`
 * directly, so the two domains never share a variable.
 */
function adapterTargetFor(asset: MaterializedAsset): AssetIdentity {
  return assetIdentity(asset.scope, asset.type, asset.effectiveName)
}

/** `type:name`, naming the alias when there is one. */
function describeTarget(asset: MaterializedAsset): string {
  return asset.authoredName === asset.effectiveName
    ? `${asset.type}:${asset.authoredName}`
    : `${asset.type}:${asset.authoredName} → ${asset.effectiveName}`
}

export interface DeleteObsoleteOptions {
  /** Adapters already filtered to those with supportsInstall === true. */
  adapters: Adapter[]
  /**
   * Effective identities to delete, already proven unclaimed by the desired
   * set. See {@link obsoleteOwnership}.
   */
  obsolete: readonly PreviousOwnership[]
  journal: InstallJournal
  onLog?: OnLog
}

/**
 * An obsolete skill bundle whose cleanup was deliberately skipped because its
 * primary file was already gone, leaving the recorded companion paths on disk
 * and no longer tracked. Carries everything a view layer needs to tell the
 * user what to clean up by hand.
 *
 * `type` is a literal rather than an `AssetType` because only a skill bundle
 * has companions to retain — a single-file asset that reads as absent has
 * nothing left to delete.
 */
export interface RetainedObsoleteBundle {
  adapter: string
  scope: Scope
  type: 'skill'
  effectiveName: string
  /** Every facet that claimed this identity. */
  facets: readonly string[]
  /** Recorded companion paths, relative to the skill root. */
  companionPaths: readonly string[]
}

export type DeleteObsoleteResult =
  | { ok: true; deleted: number; retained: readonly RetainedObsoleteBundle[] }
  | { ok: false; failure: MaterializeFailure; facets: readonly string[] }

/**
 * Delete every obsolete effective identity, once per adapter.
 *
 * This is a GLOBAL pass, and it must run before any write. Deletion used to
 * be planned per facet, which made two spec-required outcomes unreachable:
 *
 *   - **Ownership transfer.** Facet A gives up `deploy`, facet B claims it.
 *     Per-facet deletion ran A's cleanup independently of B's write, so
 *     whichever came second won — and in facet-name order, that was often the
 *     delete, destroying content B had just written.
 *   - **Duplicate historical claims.** Two facets recorded ownership of one
 *     identity, producing two deletes of the same file. The second either
 *     no-ops or, worse, removes a file the desired set still wants.
 *
 * Keying by effective adapter identity collapses both: an identity is deleted
 * at most once, and only when nothing desired claims it.
 */
export async function deleteObsoleteAssets(opts: DeleteObsoleteOptions): Promise<DeleteObsoleteResult> {
  let deleted = 0
  const retained: RetainedObsoleteBundle[] = []

  for (const adapter of opts.adapters) {
    if (adapter.supportsInstall !== true) {
      return { ok: false, failure: { kind: 'unsupported-adapter', adapter: adapter.name }, facets: [] }
    }
    const incompatibility = compatibilityFailureFor(adapter.name, adapter.apiVersion)
    if (incompatibility !== null) {
      return { ok: false, failure: { kind: 'incompatible-adapter', failure: incompatibility }, facets: [] }
    }

    for (const ownership of opts.obsolete) {
      const target = assetIdentity(ownership.scope, ownership.type, ownership.effectiveName)
      const ownedCompanionPaths = ownership.ownedCompanionPaths

      // Same F14 guard as the write pass: only a structured `not-found` is
      // trusted as "absent", because a journal entry recorded on a guess
      // would restore an asset that never existed.
      const readOutcome = await readPrevious(adapter, target, ownedCompanionPaths)
      if (!readOutcome.ok) {
        return {
          ok: false,
          failure: { kind: 'read-failed', adapter: adapter.name, asset: target, cause: readOutcome.cause },
          facets: ownership.facets,
        }
      }
      const previous = readOutcome.previous

      // A skill whose primary is gone reads as wholly absent — the bundle read
      // checks the primary first and never reaches the companions — so we hold
      // no preimage for the companion bytes the receipt still claims. Deleting
      // them anyway would be a mutation with no journal inverse: a later
      // failure would roll everything else back and report a clean rollback
      // while those bytes were gone for good. Keep them instead. They stop
      // being tracked either way, so the honest outcome is to leave the files
      // and say so, not to destroy what we cannot restore.
      if (previous === null && ownership.type === 'skill' && ownedCompanionPaths.length > 0) {
        retained.push({
          adapter: adapter.name,
          scope: ownership.scope,
          type: 'skill',
          effectiveName: ownership.effectiveName,
          facets: ownership.facets,
          companionPaths: [...ownedCompanionPaths].sort(),
        })
        opts.onLog?.(() => `[verbose]     ?${target.type}:${target.name} (primary missing — companions retained)`)
        continue
      }

      let deletedPath: string | undefined
      try {
        const result = await adapter.deleteAsset(deleteRequestFor(target, ownedCompanionPaths))
        if (!result.ok) {
          return {
            ok: false,
            failure: {
              kind: 'delete-failed',
              adapter: adapter.name,
              asset: target,
              cause: describeAssetFailure(result.failure),
            },
            facets: ownership.facets,
          }
        }
        deletedPath = result.deletedPaths[0]
        // Count what actually existed rather than what was planned: a
        // receipt entry for an already-removed file is not a removal.
        if (result.existed) deleted++
      } catch (err) {
        return {
          ok: false,
          failure: {
            kind: 'delete-failed',
            adapter: adapter.name,
            asset: target,
            cause: err instanceof Error ? err.message : String(err),
          },
          facets: ownership.facets,
        }
      }
      opts.onLog?.(() => `[verbose]     -${target.type}:${target.name}${deletedPath ? ` → ${deletedPath}` : ''}`)

      if (previous) {
        opts.journal.record({
          label: `delete ${adapter.name}:${target.type}:${target.name}`,
          undo: async () => {
            await runUndoInstall(
              adapter,
              target,
              previous.content,
              previous.metadata ?? {},
              previous.companions,
              Object.keys(previous.companions),
            )
          },
        })
      }
    }
  }

  return { ok: true, deleted, retained }
}

/**
 * Bridge from the engine's asset entry to the adapter's tagged install
 * request. A skill request carries the new companion bundle (verbatim bytes
 * keyed skill-root-relative) plus the engine-verified set of previously-owned
 * companion paths, so the adapter replaces exactly the owned paths absent from
 * the new bundle and never touches unowned files. An empty companion map and
 * empty owned set reproduce the single-file behavior.
 */
function installRequestFor(
  asset: AssetIdentity,
  content: string,
  metadata: unknown,
  companions: CompanionMap,
  ownedCompanionPaths: readonly string[],
): InstallAssetRequest {
  if (asset.type === 'skill') {
    return {
      assetType: 'skill',
      scope: asset.scope,
      name: asset.name,
      content,
      metadata,
      companions,
      ownedCompanionPaths,
    }
  }
  return { assetType: asset.type, scope: asset.scope, name: asset.name, content, metadata }
}

function readRequestFor(asset: AssetIdentity, ownedCompanionPaths: readonly string[]): ReadAssetRequest {
  if (asset.type === 'skill') {
    return { assetType: 'skill', scope: asset.scope, name: asset.name, ownedCompanionPaths }
  }
  return { assetType: asset.type, scope: asset.scope, name: asset.name }
}

function deleteRequestFor(asset: AssetIdentity, ownedCompanionPaths: readonly string[]): DeleteAssetRequest {
  if (asset.type === 'skill') {
    return { assetType: 'skill', scope: asset.scope, name: asset.name, ownedCompanionPaths }
  }
  return { assetType: asset.type, scope: asset.scope, name: asset.name }
}

/** The captured prior state of an asset — its primary content, metadata, and
 * (for skills) the bytes of its previously-owned companions. Used for
 * skip-if-identical comparison and full-bundle rollback preimages. */
interface PreviousAsset {
  content: string
  metadata?: Record<string, unknown>
  companions: CompanionMap
}

/**
 * Read an asset's previous state for rollback capture, including its
 * previously-owned companion bytes for skills. The structured `not-found` is
 * the one "asset didn't exist" signal we trust — every other failure (and any
 * throw, which is an adapter bug) means `previous` is unknown, so the caller
 * must fail loud instead of assuming absence.
 *
 * `ownedCompanionPaths` is the engine-verified previously-owned set, which
 * comes from the install receipt and nothing else; the read returns exactly
 * those companions that exist, so unowned files are never swept into the
 * preimage.
 */
async function readPrevious(
  adapter: Adapter,
  asset: AssetIdentity,
  ownedCompanionPaths: readonly string[],
): Promise<{ ok: true; previous: PreviousAsset | null } | { ok: false; cause: string }> {
  try {
    const result = await adapter.readAsset(readRequestFor(asset, ownedCompanionPaths))
    if (result.ok) {
      const companions = result.asset.assetType === 'skill' ? result.asset.companions : {}
      return { ok: true, previous: { content: result.asset.content, metadata: result.asset.metadata, companions } }
    }
    if (result.failure.code === 'not-found') return { ok: true, previous: null }
    return { ok: false, cause: describeAssetFailure(result.failure) }
  } catch (err) {
    return { ok: false, cause: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Run an inverse install during rollback. The adapter contract returns
 * structured failures rather than throwing, but the journal counts an undo
 * as failed only when it *throws*. So a `{ ok: false }` inverse op — which
 * leaves on-disk state un-restored — must be surfaced as a throw here, or
 * `InstallJournal.rollback()` would report a clean rollback while an asset
 * was never restored. A thrown adapter bug propagates unchanged.
 */
async function runUndoInstall(
  adapter: Adapter,
  asset: AssetIdentity,
  content: string,
  metadata: Record<string, unknown>,
  companions: CompanionMap,
  ownedCompanionPaths: readonly string[],
): Promise<void> {
  const result = await adapter.installAsset(
    installRequestFor(asset, content, metadata, companions, ownedCompanionPaths),
  )
  if (!result.ok) {
    throw new Error(
      `undo install ${adapter.name}:${asset.type}:${asset.name} failed: ${describeAssetFailure(result.failure)}`,
    )
  }
}

/** Inverse delete during rollback. Same throw-on-`{ ok: false }` rule as {@link runUndoInstall}. */
async function runUndoDelete(
  adapter: Adapter,
  asset: AssetIdentity,
  ownedCompanionPaths: readonly string[],
): Promise<void> {
  const result = await adapter.deleteAsset(deleteRequestFor(asset, ownedCompanionPaths))
  if (!result.ok) {
    throw new Error(
      `undo delete ${adapter.name}:${asset.type}:${asset.name} failed: ${describeAssetFailure(result.failure)}`,
    )
  }
}

/** Deduplicated, deterministically ordered union of two owned-path sets. */
function unionPaths(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort()
}

/**
 * Compare two companion maps for byte-exact equality. Used by
 * skip-if-identical so a drifted or added/removed companion forces a repair
 * through the atomic bundle replacement.
 */
function companionsIdentical(a: CompanionMap, b: CompanionMap): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!bytesEqual(a[key], b[key])) return false
  }
  return true
}

function bytesEqual(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === undefined || b === undefined || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * The skill-root-relative companion paths that differ between the previously
 * installed bundle and the new one — drifted (bytes changed), added, or
 * removed. Sorted for stable, reviewable output. Used for path-specific drift
 * reporting.
 */
function driftedCompanionPaths(previous: CompanionMap, next: CompanionMap): string[] {
  const paths = new Set<string>([...Object.keys(previous), ...Object.keys(next)])
  const drifted: string[] = []
  for (const path of paths) {
    if (!bytesEqual(previous[path], next[path])) drifted.push(path)
  }
  return drifted.sort()
}

/** Render a structured adapter failure as a one-line cause string. */
function describeAssetFailure(failure: AdapterAssetFailure): string {
  switch (failure.code) {
    case 'not-found':
      return 'asset not found'
    case 'invalid-companion-path':
      return `invalid companion path "${failure.path}": ${failure.reason}`
    case 'unsupported-scope':
      return `scope "${failure.scope}" is not supported by this adapter`
    case 'not-implemented':
      return `adapter does not implement ${failure.method}`
    case 'io-failed':
      return `${failure.operation} failed${failure.path ? ` at ${failure.path}` : ''}: ${failure.message}`
  }
}

/**
 * One asset's declaration in the resolved facet manifest, looked up by its
 * AUTHORED name.
 *
 * Every authored-domain read goes through here so the three of them cannot
 * disagree about which key to use. Aliasing deliberately cannot reach this
 * function: an alias changes where an asset lands, never what a publisher
 * declared, so the manifest is only ever indexed by the authored name.
 *
 * The plan being materialized was derived from this same manifest by
 * `buildVerifiedAssetPlan`, so a miss cannot happen for a well-formed record.
 * Absence therefore degrades to empty content rather than inventing a failure
 * mode the pipeline cannot produce.
 */
function declarationFor(
  manifest: ResolvedFacetManifest,
  asset: MaterializedAsset,
): { prompt?: string; description?: string; adapters?: Record<string, unknown> } | undefined {
  switch (asset.type) {
    case 'skill':
      return manifest.skills?.[asset.authoredName]
    case 'agent':
      return manifest.agents?.[asset.authoredName]
    case 'command':
      return manifest.commands?.[asset.authoredName]
  }
}

function contentFor(manifest: ResolvedFacetManifest, asset: MaterializedAsset): string {
  return declarationFor(manifest, asset)?.prompt ?? ''
}

function adapterExtrasFor(
  manifest: ResolvedFacetManifest,
  asset: MaterializedAsset,
  adapterName: string,
): Record<string, unknown> | undefined {
  const entry = declarationFor(manifest, asset)?.adapters?.[adapterName]
  if (entry && typeof entry === 'object') return entry as Record<string, unknown>
  return undefined
}

/**
 * Build the front-matter metadata bag the adapter writes at the top of the
 * installed file. Every asset type gets `name` + `description` as the
 * required minimum; adapter-specific extras from the manifest's
 * `adapters.<name>` block are merged underneath so computed
 * `name`/`description` always win — a facet cannot override the asset
 * identity via its adapter-extras block (F2 guard).
 *
 * `name` is the EFFECTIVE name. Front matter labels the file on disk, and
 * agents resolve assets by the name they are invoked with; writing the
 * authored name into an aliased file would hand the tool an identity that
 * does not exist at that location. `description` stays authored — it is
 * content, and aliasing does not rewrite content.
 */
function buildAssetMetadata(
  manifest: ResolvedFacetManifest,
  asset: MaterializedAsset,
  adapterName: string,
): Record<string, unknown> {
  return {
    ...(adapterExtrasFor(manifest, asset, adapterName) ?? {}),
    name: asset.effectiveName,
    description: declarationFor(manifest, asset)?.description ?? '',
  }
}
