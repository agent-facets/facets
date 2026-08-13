import type {
  Adapter,
  AdapterPlanFailure,
  AssetCapability,
  AssetInstallPlan,
  AssetRemovalPlan,
  CompanionMap,
  PlanAssetInstallRequest,
  PlanAssetRemovalRequest,
} from '@agent-facets/adapter'
import type { MaterializedAsset, ResolvedFacetManifest } from '@agent-facets/protocol'
import { type AdapterCompatibilityFailure, compatibilityFailureFor } from '../adapters/api-compatibility.ts'
import type { FileTransaction, FileTransactionFailure } from '../fs/index.ts'
import type { AssetTakeoverResolver } from './asset-takeover.ts'
import { ownedCompanionPathsFor, ownershipFor, type PreviousOwnership } from './commit/ownership.ts'
import { type AssetIdentity, assetIdentity, type OnLog, type StageEvent } from './types.ts'
import { authoredCompanionKey, type SkillCompanionBytes } from './verified-asset-plan.ts'

export interface MaterializeOptions {
  /** Facet name — used to tag per-adapter progress events. */
  facetName: string
  manifest: ResolvedFacetManifest
  /**
   * The project this run is installing into.
   *
   * Handed to every adapter request, including user-scope ones. It is the only
   * definition of "this project" an adapter may use: one that derived its own
   * from the process working directory would resolve project-scoped assets
   * against a different tree than the manifest, lockfile, and receipt.
   */
  projectRoot: string
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
  /** The run's filesystem transaction. Every mutation goes through it. */
  transaction: FileTransaction
  /**
   * Interactive gate for an occupied destination this machine does not own.
   *
   * Absent means continue — the opposite default from the collision
   * resolver, and deliberately so: a collision has no correct answer without
   * the user, while a takeover has one that preserves existing behavior.
   */
  resolveAssetTakeover?: AssetTakeoverResolver
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
  /** Assets whose plan changed at least one file. */
  written: number
  /** Assets already in their desired state, so nothing was planned. */
  skipped: number
}

/**
 * Discriminated failure for `materialize`.
 *
 *   - `unsupported-adapter` — the adapter declares no asset capability, so it
 *     cannot materialize anything. Defense-in-depth beyond the picker filter;
 *     loud failure beats silent no-op.
 *   - `incompatible-adapter` — the adapter does not declare a CLI-supported
 *     API. Invariant check only: the primary gates are the command-level
 *     fail-closed load and the runInstall preflight.
 *   - `plan-failed` — the adapter's read-only planning reported a structured
 *     failure. Nothing was written: planning never writes.
 *   - `transaction-failed` — the plan was refused or could not be applied.
 *     Refusal means nothing was armed; an abort means the batch was already
 *     returned to its pre-batch state.
 *   - `takeover-cancelled` — the user declined to adopt an occupied,
 *     untracked destination.
 */
export type MaterializeFailure =
  | { kind: 'unsupported-adapter'; adapter: string }
  | { kind: 'incompatible-adapter'; failure: AdapterCompatibilityFailure }
  | {
      kind: 'plan-failed'
      operation: 'install' | 'removal'
      adapter: string
      asset: AssetIdentity
      cause: string
    }
  | { kind: 'transaction-failed'; adapter: string; asset: AssetIdentity; failure: FileTransactionFailure }
  | { kind: 'takeover-cancelled'; adapter: string; asset: AssetIdentity }

/**
 * Result of one `materialize` call. Errors are values, not control flow — the
 * caller pattern-matches on `failure.kind` and routes each to the matching
 * `RunInstallFailure` code.
 */
export type MaterializeResult = ({ ok: true } & MaterializeCounts) | { ok: false; failure: MaterializeFailure }

/**
 * Plan every asset across all selected adapters and commit each plan through
 * the run's filesystem transaction.
 *
 * The adapter decides *what* should change; the transaction decides whether
 * the file is still in the state that decision was made from, performs the
 * change, and remembers both endpoints so a later failure can put the file
 * back byte for byte. An asset already in its desired state produces no
 * mutation at all — not a rewrite of identical bytes — so re-installing
 * touches no modification times and journals nothing.
 */
export async function materialize(opts: MaterializeOptions): Promise<MaterializeResult> {
  let written = 0
  let skipped = 0

  for (const adapter of opts.adapters) {
    const resolved = assetCapabilityFor(adapter)
    if (!resolved.ok) return { ok: false, failure: resolved.failure }
    const capability = resolved.capability

    opts.onLog?.(() => `[verbose]   installing ${opts.facetName}@${opts.manifest.version} → ${adapter.name}`)

    for (const asset of opts.newAssets) {
      const target = adapterTargetFor(asset)
      // NEW companion bytes for this skill, keyed by AUTHORED identity (empty
      // for companion-less skills and non-skill assets); PREVIOUS owned paths
      // keyed by EFFECTIVE identity, so taking a name over from another facet
      // cleans up that facet's leftovers.
      const companions =
        opts.companionBytes?.get(authoredCompanionKey(asset.scope, asset.type, asset.authoredName)) ?? {}
      const ownedCompanionPaths = ownedCompanionPathsFor(opts.previousOwnership, asset)

      const planned = await planInstall(capability, {
        projectRoot: opts.projectRoot,
        target,
        content: contentFor(opts.manifest, asset),
        metadata: buildAssetMetadata(opts.manifest, asset, adapter.name),
        companions,
        ownedCompanionPaths,
      })
      if (!planned.ok) {
        return {
          ok: false,
          failure: {
            kind: 'plan-failed',
            operation: 'install',
            adapter: adapter.name,
            asset: target,
            cause: planned.cause,
          },
        }
      }
      const plan = planned.plan

      // The just-in-time takeover gate. Reached only when something is already
      // at this destination AND this machine's receipt does not own it — an
      // owned identity reconciles without a warning, and an empty one is a
      // creation.
      //
      // Placed before the no-op check because an equivalent untracked
      // destination is still being adopted: the bytes do not change, but this
      // machine is about to start claiming a file someone else put there.
      if (plan.occupancy !== 'absent' && ownershipFor(opts.previousOwnership, asset) === undefined) {
        const occupancy = plan.occupancy
        opts.onStage?.({
          kind: 'asset-takeover-required',
          facet: opts.facetName,
          adapter: adapter.name,
          asset: target,
          occupancy,
        })
        const decision = opts.resolveAssetTakeover
          ? await opts.resolveAssetTakeover({
              facet: opts.facetName,
              adapter: adapter.name,
              asset: target,
              authoredName: asset.authoredName,
              occupancy,
            })
          : { kind: 'continue' as const }
        if (decision.kind === 'cancelled') {
          opts.onStage?.({
            kind: 'asset-takeover-cancelled',
            facet: opts.facetName,
            adapter: adapter.name,
            asset: target,
          })
          return { ok: false, failure: { kind: 'takeover-cancelled', adapter: adapter.name, asset: target } }
        }
        opts.onStage?.({
          kind: 'asset-takeover-accepted',
          facet: opts.facetName,
          adapter: adapter.name,
          asset: target,
        })
      }

      if (plan.action.kind === 'unchanged') {
        opts.onLog?.(() => `[verbose]     =${describeTarget(asset)} (skipped)`)
        skipped++
        continue
      }

      // Sigil: `+` new asset (didn't exist before), `~` repaired/updated.
      const sigil = plan.occupancy === 'absent' ? '+' : '~'
      // Path-specific reporting: the batch names the exact files that change,
      // so a repaired bundle reports the drifted companion rather than only
      // the owning asset.
      for (const mutation of plan.action.mutations) {
        opts.onLog?.(() => `[verbose]     ${sigil}${describeTarget(asset)} ${mutation.kind}: ${mutation.path}`)
      }

      const applied = opts.transaction.apply(plan.action)
      if (!applied.ok) {
        return {
          ok: false,
          failure: { kind: 'transaction-failed', adapter: adapter.name, asset: target, failure: applied.failure },
        }
      }
      opts.onLog?.(() => `[verbose]     ${sigil}${describeTarget(asset)} → ${plan.primaryPath}`)
      written++
    }

    opts.onStage?.({ kind: 'adapter-complete', facet: opts.facetName, adapter: adapter.name })
  }

  return { ok: true, written, skipped }
}

/**
 * The adapter-facing identity of a planned asset: its EFFECTIVE name.
 *
 * Every adapter request, log line, and failure report addresses the file on
 * disk, which is named by the project's disposition — not by the publisher.
 * Content, description, adapter extras, companion bytes, and integrity all
 * stay authored and are looked up from `asset.authoredName` directly, so the
 * two domains never share a variable.
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
  projectRoot: string
  adapters: Adapter[]
  /**
   * Effective identities to delete, already proven unclaimed by the desired
   * set. See {@link obsoleteOwnership}.
   */
  obsolete: readonly PreviousOwnership[]
  transaction: FileTransaction
  onLog?: OnLog
}

export type DeleteObsoleteResult =
  | { ok: true; deleted: number }
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

  for (const adapter of opts.adapters) {
    const resolved = assetCapabilityFor(adapter)
    if (!resolved.ok) return { ok: false, failure: resolved.failure, facets: [] }
    const capability = resolved.capability

    for (const ownership of opts.obsolete) {
      const target = assetIdentity(ownership.scope, ownership.type, ownership.effectiveName)

      const planned = await planRemoval(capability, {
        projectRoot: opts.projectRoot,
        target,
        ownedCompanionPaths: ownership.ownedCompanionPaths,
      })
      if (!planned.ok) {
        return {
          ok: false,
          failure: {
            kind: 'plan-failed',
            operation: 'removal',
            adapter: adapter.name,
            asset: target,
            cause: planned.cause,
          },
          facets: ownership.facets,
        }
      }

      // Already gone. A receipt entry for a file that is not there is not a
      // removal, so it is neither counted nor journaled.
      if (planned.plan.kind === 'absent') continue

      for (const mutation of planned.plan.action.mutations) {
        opts.onLog?.(() => `[verbose]     -${target.type}:${target.name} → ${mutation.path}`)
      }

      const applied = opts.transaction.apply(planned.plan.action)
      if (!applied.ok) {
        return {
          ok: false,
          failure: { kind: 'transaction-failed', adapter: adapter.name, asset: target, failure: applied.failure },
          facets: ownership.facets,
        }
      }
      deleted++
    }
  }

  return { ok: true, deleted }
}

/**
 * The adapter's asset capability, or the failure explaining why it has none.
 *
 * Both checks are invariants rather than primary gates: the picker filters on
 * the capability and the runInstall preflight checks the API, both before any
 * materialization. Reaching either arm means an upstream gate was bypassed.
 */
function assetCapabilityFor(
  adapter: Adapter,
): { ok: true; capability: AssetCapability } | { ok: false; failure: MaterializeFailure } {
  if (adapter.assets === false) {
    return { ok: false, failure: { kind: 'unsupported-adapter', adapter: adapter.name } }
  }
  const incompatibility = compatibilityFailureFor(adapter.name, adapter.apiVersion)
  if (incompatibility !== null) {
    return { ok: false, failure: { kind: 'incompatible-adapter', failure: incompatibility } }
  }
  return { ok: true, capability: adapter.assets }
}

interface InstallPlanInput {
  projectRoot: string
  target: AssetIdentity
  content: string
  metadata: unknown
  companions: CompanionMap
  ownedCompanionPaths: readonly string[]
}

type PlanInstallOutcome = { ok: true; plan: AssetInstallPlan } | { ok: false; cause: string }

/**
 * Ask the adapter to plan an install, converting a thrown adapter bug into the
 * same structured shape as a reported failure. Planning is read-only, so
 * neither outcome has left anything behind.
 */
async function planInstall(capability: AssetCapability, input: InstallPlanInput): Promise<PlanInstallOutcome> {
  try {
    const result = await capability.planInstall(installRequestFor(input))
    return result.ok ? { ok: true, plan: result.plan } : { ok: false, cause: describePlanFailure(result.failure) }
  } catch (err) {
    return { ok: false, cause: err instanceof Error ? err.message : String(err) }
  }
}

interface RemovalPlanInput {
  projectRoot: string
  target: AssetIdentity
  ownedCompanionPaths: readonly string[]
}

type PlanRemovalOutcome = { ok: true; plan: AssetRemovalPlan } | { ok: false; cause: string }

async function planRemoval(capability: AssetCapability, input: RemovalPlanInput): Promise<PlanRemovalOutcome> {
  try {
    const result = await capability.planRemoval(removalRequestFor(input))
    return result.ok ? { ok: true, plan: result.plan } : { ok: false, cause: describePlanFailure(result.failure) }
  } catch (err) {
    return { ok: false, cause: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Bridge from the engine's asset entry to the adapter's tagged planning
 * request. A skill request carries the new companion bundle (verbatim bytes
 * keyed skill-root-relative) plus the engine-verified set of previously-owned
 * companion paths, so the plan removes exactly the owned paths absent from the
 * new bundle and never touches unowned files.
 */
function installRequestFor(input: InstallPlanInput): PlanAssetInstallRequest {
  const base = { projectRoot: input.projectRoot, scope: input.target.scope, name: input.target.name }
  if (input.target.type === 'skill') {
    return {
      ...base,
      assetType: 'skill',
      content: input.content,
      metadata: input.metadata,
      companions: input.companions,
      ownedCompanionPaths: input.ownedCompanionPaths,
    }
  }
  return { ...base, assetType: input.target.type, content: input.content, metadata: input.metadata }
}

function removalRequestFor(input: RemovalPlanInput): PlanAssetRemovalRequest {
  const base = { projectRoot: input.projectRoot, scope: input.target.scope, name: input.target.name }
  if (input.target.type === 'skill') {
    return { ...base, assetType: 'skill', ownedCompanionPaths: input.ownedCompanionPaths }
  }
  return { ...base, assetType: input.target.type }
}

/** Render a structured adapter planning failure as a one-line cause string. */
function describePlanFailure(failure: AdapterPlanFailure): string {
  switch (failure.code) {
    case 'invalid-companion-path':
      return `invalid companion path "${failure.path}": ${failure.reason}`
    case 'unsupported-scope':
      return `scope "${failure.scope}" is not supported by this adapter`
    case 'io-failed':
      return `could not read ${failure.path}: ${failure.message}`
    case 'unsupported-object':
      return `${failure.path} cannot be written through: ${failure.detail}`
    case 'unrepresentable':
      return `${failure.path} cannot be represented in this adapter's format: ${failure.detail}`
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
