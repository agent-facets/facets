import type {
  Adapter,
  AdapterAssetFailure,
  CompanionMap,
  DeleteAssetRequest,
  InstallAssetRequest,
  ReadAssetRequest,
} from '@agent-facets/adapter'
import { splitFrontMatter } from '@agent-facets/common'
import type { ResolvedFacetManifest } from '@agent-facets/protocol'
import { type AdapterCompatibilityFailure, compatibilityFailureFor } from '../adapters/api-compatibility.ts'
import type { InstallJournal } from './journal.ts'
import type { AssetIdentity, MaterializedAssetOwnership, OnLog, StageEvent } from './types.ts'
import type { SkillCompanionBytes } from './verified-asset-plan.ts'

/**
 * Compute the NEW asset set a facet contributes at this version. Derived
 * from the resolved build-time manifest (prompts already loaded).
 *
 * Default scope is `project`: facets live alongside a project's code, so
 * their assets should land in the project's adapter tree (e.g.
 * `<cwd>/.claude/skills/...`) rather than a user-wide location. Per-asset
 * scope overrides in the manifest are a roadmap item.
 *
 * The ordering (skills → agents → commands, alphabetical within each type)
 * is deterministic so lockfile diffs are stable across runs.
 */
export function computeAssetList(manifest: ResolvedFacetManifest): AssetIdentity[] {
  const assets: AssetIdentity[] = []

  for (const name of Object.keys(manifest.skills ?? {}).sort()) {
    assets.push({ scope: 'project', type: 'skill', name })
  }
  for (const name of Object.keys(manifest.agents ?? {}).sort()) {
    assets.push({ scope: 'project', type: 'agent', name })
  }
  for (const name of Object.keys(manifest.commands ?? {}).sort()) {
    assets.push({ scope: 'project', type: 'command', name })
  }

  return assets
}

/**
 * Diff OLD vs NEW asset sets. Returns the entries present in OLD but not in
 * NEW — those must be deleted from every adapter so on-disk state converges
 * with the freshly-installed version (drift-proof behavior).
 */
export function diffAssetsForDeletion(
  oldAssets: readonly MaterializedAssetOwnership[],
  newAssets: readonly AssetIdentity[],
): MaterializedAssetOwnership[] {
  const newKeys = new Set(newAssets.map(assetKey))
  return oldAssets.filter((asset) => !newKeys.has(assetKey(asset)))
}

function assetKey(asset: AssetIdentity): string {
  return `${asset.scope}:${asset.type}:${asset.name}`
}

export interface MaterializeOptions {
  /** Facet name — used to tag per-adapter progress events. */
  facetName: string
  manifest: ResolvedFacetManifest
  /** Adapters already filtered to those with supportsInstall === true. */
  adapters: Adapter[]
  /**
   * What this machine previously materialized for the facet (OLD set),
   * already normalized to identity plus owned inner-archive paths. Empty
   * array when nothing was materialized before.
   */
  oldAssets: readonly MaterializedAssetOwnership[]
  /** The authored identities to materialize now (NEW set). */
  newAssets: readonly AssetIdentity[]
  /**
   * Skill companion bytes for the assets being installed, keyed by
   * `skill:<name>` (from the resolver's verified asset plan). Absent on the
   * frozen-reproduction path (no fresh plan) and for delete-only calls; a
   * missing entry or map means "no companions" (single-file behavior).
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
  /** Assets deleted (drift removal within this facet). */
  deleted: number
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
  const toDelete = diffAssetsForDeletion(opts.oldAssets, opts.newAssets)
  let written = 0
  let skipped = 0
  let deleted = 0

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

    // Previous owned companion paths per asset key — the engine-verified set
    // from the OLD lockfile entry, used both to read the prior bundle and to
    // tell the adapter which owned paths a replacement may remove.
    const oldOwnedByKey = new Map<string, string[]>()
    for (const old of opts.oldAssets) {
      oldOwnedByKey.set(assetKey(old), ownedCompanionPathsOf(old))
    }

    for (const asset of opts.newAssets) {
      const content = contentFor(opts.manifest, asset)
      const metadata = buildAssetMetadata(opts.manifest, asset, adapter.name)
      // NEW companion bytes for this skill (empty for companion-less skills
      // and non-skill assets); PREVIOUS owned paths for safe replacement.
      const companions = opts.companionBytes?.get(assetKey(asset)) ?? {}
      const ownedCompanionPaths = oldOwnedByKey.get(assetKey(asset)) ?? []

      // Capture original state for rollback (F14). Treating any failure
      // as "didn't exist" would let the journal's delete-undo silently
      // delete a pre-existing asset we never read successfully. Narrow to
      // the structured `not-found` only and surface everything else as
      // `read-failed` — install fails loud before we write anything.
      const readOutcome = await readPrevious(adapter, asset, ownedCompanionPaths)
      if (!readOutcome.ok) {
        return {
          ok: false,
          failure: { kind: 'read-failed', adapter: adapter.name, asset, cause: readOutcome.cause },
        }
      }
      const previous = readOutcome.previous

      // Skip-if-identical: when the on-disk content + metadata already
      // matches what we would write, no work is needed and no journal
      // entry is recorded (there's nothing to undo).
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
        opts.onLog?.(() => `[verbose]     =${asset.type}:${asset.name} (skipped)`)
        skipped++
        continue
      }

      // Sigil: `+` new asset (didn't exist before), `~` repaired/updated (existed but changed)
      const sigil = previous === null ? '+' : '~'

      // Path-specific drift reporting (design D10, task 9.7): when an existing
      // bundle is being repaired, name the exact companion paths that differ
      // (drifted, added, or removed) rather than only the owning asset.
      if (previous !== null && asset.type === 'skill') {
        for (const path of driftedCompanionPaths(previous.companions, companions)) {
          opts.onLog?.(() => `[verbose]     ~${asset.type}:${asset.name} drift: skills/${asset.name}/${path}`)
        }
      }

      let writtenPath: string | undefined
      try {
        const result = await adapter.installAsset(
          installRequestFor(asset, content, metadata, companions, ownedCompanionPaths),
        )
        if (!result.ok) {
          return {
            ok: false,
            failure: {
              kind: 'install-failed',
              adapter: adapter.name,
              asset,
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
            asset,
            cause: err instanceof Error ? err.message : String(err),
          },
        }
      }
      opts.onLog?.(() => `[verbose]     ${sigil}${asset.type}:${asset.name}${writtenPath ? ` → ${writtenPath}` : ''}`)
      written++

      // Rollback preimage: restore the COMPLETE prior bundle (primary +
      // previously-owned companion bytes), or delete a freshly-created asset.
      // The owned-path set handed to the restore install is the union of the
      // paths this operation could have written or removed, so the restore
      // converges the bundle back to its prior state without touching unowned
      // files. Companion-less skills and single-file assets restore exactly
      // as before.
      const restoreOwned = previous ? Object.keys(previous.companions) : ownedCompanionPaths
      opts.journal.record({
        label: `install ${adapter.name}:${asset.type}:${asset.name}`,
        undo: async () => {
          if (previous) {
            await runUndoInstall(
              adapter,
              asset,
              previous.content,
              previous.metadata ?? {},
              previous.companions,
              restoreOwned,
            )
          } else {
            await runUndoDelete(adapter, asset, ownedCompanionPaths)
          }
        },
      })
    }

    for (const asset of toDelete) {
      // The owned companion paths to delete come from the OLD entry — the set
      // this machine materialized for the asset being removed.
      const ownedCompanionPaths = oldOwnedByKey.get(assetKey(asset)) ?? ownedCompanionPathsOf(asset)

      // Same F14 guard as the install branch above.
      const readOutcome = await readPrevious(adapter, asset, ownedCompanionPaths)
      if (!readOutcome.ok) {
        return {
          ok: false,
          failure: { kind: 'read-failed', adapter: adapter.name, asset, cause: readOutcome.cause },
        }
      }
      const previous = readOutcome.previous

      let deletedPath: string | undefined
      try {
        const result = await adapter.deleteAsset(deleteRequestFor(asset, ownedCompanionPaths))
        if (!result.ok) {
          return {
            ok: false,
            failure: {
              kind: 'delete-failed',
              adapter: adapter.name,
              asset,
              cause: describeAssetFailure(result.failure),
            },
          }
        }
        deletedPath = result.deletedPaths[0]
      } catch (err) {
        return {
          ok: false,
          failure: {
            kind: 'delete-failed',
            adapter: adapter.name,
            asset,
            cause: err instanceof Error ? err.message : String(err),
          },
        }
      }
      opts.onLog?.(() => `[verbose]     -${asset.type}:${asset.name}${deletedPath ? ` → ${deletedPath}` : ''}`)
      deleted++

      if (previous) {
        opts.journal.record({
          label: `delete ${adapter.name}:${asset.type}:${asset.name}`,
          undo: async () => {
            await runUndoInstall(
              adapter,
              asset,
              previous.content,
              previous.metadata ?? {},
              previous.companions,
              Object.keys(previous.companions),
            )
          },
        })
      }
    }

    opts.onStage?.({ kind: 'adapter-complete', facet: opts.facetName, adapter: adapter.name })
  }

  return { ok: true, written, skipped, deleted }
}

/**
 * The skill-root-relative companion paths a locked or receipt asset entry
 * owns — every owned inner-archive path except the primary `SKILL.md`.
 *
 * Accepts both owned-path shapes: a lockfile asset's `files: {path,integrity}[]`
 * and a receipt asset's `files: string[]` (both carry full inner-archive
 * paths). A legacy identity-only entry has no `files`, so it owns no
 * companions (single-file behavior). Paths are converted from the full inner-
 * archive form to the skill-root-relative form the adapter contract uses.
 */
export function ownedCompanionPathsOf(asset: MaterializedAssetOwnership): string[] {
  if (asset.type !== 'skill') return []
  const skillRoot = `skills/${asset.name}/`
  const primary = `skills/${asset.name}/SKILL.md`
  const owned: string[] = []
  for (const path of asset.ownedPaths) {
    if (path === primary) continue
    owned.push(path.startsWith(skillRoot) ? path.slice(skillRoot.length) : path)
  }
  return owned
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
 * `ownedCompanionPaths` is the engine-verified previously-owned set (from the
 * lockfile/receipt); the read returns exactly those companions that exist, so
 * unowned files are never swept into the preimage.
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

function contentFor(manifest: ResolvedFacetManifest, asset: AssetIdentity): string {
  if (asset.type === 'skill') return manifest.skills?.[asset.name]?.prompt ?? ''
  if (asset.type === 'agent') return manifest.agents?.[asset.name]?.prompt ?? ''
  return manifest.commands?.[asset.name]?.prompt ?? ''
}

function descriptionFor(manifest: ResolvedFacetManifest, asset: AssetIdentity): string {
  if (asset.type === 'skill') return manifest.skills?.[asset.name]?.description ?? ''
  if (asset.type === 'agent') return manifest.agents?.[asset.name]?.description ?? ''
  return manifest.commands?.[asset.name]?.description ?? ''
}

function adapterExtrasFor(
  manifest: ResolvedFacetManifest,
  asset: AssetIdentity,
  adapterName: string,
): Record<string, unknown> | undefined {
  const adapters =
    asset.type === 'skill'
      ? manifest.skills?.[asset.name]?.adapters
      : asset.type === 'agent'
        ? manifest.agents?.[asset.name]?.adapters
        : manifest.commands?.[asset.name]?.adapters
  if (!adapters) return undefined
  const entry = adapters[adapterName]
  if (entry && typeof entry === 'object') return entry as Record<string, unknown>
  return undefined
}

/**
 * Build the front-matter metadata bag the adapter writes at the top of the
 * installed file. Every asset type gets `name` + `description` as the
 * required minimum (per user ask); adapter-specific extras from the
 * manifest's `adapters.<name>` block are merged underneath so computed
 * `name`/`description` always win — a facet cannot override the asset
 * identity via its adapter-extras block (F2 guard).
 */
function buildAssetMetadata(
  manifest: ResolvedFacetManifest,
  asset: AssetIdentity,
  adapterName: string,
): Record<string, unknown> {
  return {
    ...(adapterExtrasFor(manifest, asset, adapterName) ?? {}),
    name: asset.name,
    description: descriptionFor(manifest, asset),
  }
}
