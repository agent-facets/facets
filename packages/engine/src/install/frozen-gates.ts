import {
  compareCodeUnits,
  type FacetContribution,
  LOCKFILE_VERSION_0_3,
  LOCKFILE_VERSION_0_4,
  lockedDispositionOf,
  type PlanLockedServerInventoryResult,
  planLockedServerInventory,
  planMaterialization,
  type SupportedLockfile,
  type SupportedLockfileVersion,
  sameDisposition,
} from '@agent-facets/protocol'
import { countAssetOverrides, countServerOverrides, type NormalizedFacetEntry } from '../manifest/mutations.ts'
import type { MaterializationAliasProblem } from './commit/collision-plan.ts'
import { detectLockfileDrift } from './detect-lockfile-drift.ts'
import { ownEntry } from './own-entry.ts'
import type {
  LockedMaterializationCollisionGroup,
  LockfileDriftEntry,
  RunInstallFailure,
  StaleMaterializationOverride,
} from './types.ts'

/**
 * The frozen-lockfile consistency gate.
 *
 * Everything here is decided from the manifest and the lockfile alone, before
 * a single facet is fetched, cloned, or built. That ordering is the point: a
 * frozen install that is going to refuse should refuse without touching the
 * network, and — because the journal has not opened yet — without any
 * possibility of mutation.
 *
 * The materialization checks exist because frozen mode has two jobs that pull
 * against each other. It must reproduce recorded state exactly, and it must
 * never write. A manifest carrying materialization intent the lockfile does
 * not record is a request to do both: apply a new decision AND leave the
 * lockfile alone. There is no honest way to satisfy that, so it fails.
 */

export interface FrozenGateArgs {
  facets: Readonly<Record<string, NormalizedFacetEntry>>
  previousLockfile: SupportedLockfile
  /** The exact schema the lockfile bytes validated under. */
  lockfileVersion: SupportedLockfileVersion
  lockfileExisted: boolean
}

/**
 * Check every frozen consistency rule. Returns the first failing category, or
 * `null` when the lockfile fully and consistently covers the manifest.
 *
 * Categories are ordered by how fundamental they are, so a user fixes causes
 * rather than symptoms: coverage first (is this lockfile even about this
 * manifest?), then format (can it express what the manifest asks for?), then
 * the specific disagreements.
 */
export function checkFrozenConsistency(args: FrozenGateArgs): RunInstallFailure | null {
  const { facets, previousLockfile, lockfileVersion, lockfileExisted } = args

  // 1. Coverage: sources, versions, orphans.
  const coverage = detectLockfileDrift(facets, previousLockfile, lockfileExisted)
  if (coverage.length > 0) {
    return { code: 'LOCKFILE_DRIFT', facets: coverage }
  }

  // 2. Format. Each disposition domain has its own exact capability set —
  //    never a numeric comparison, and never "is it the writer version". A
  //    `0.2` lockfile has nowhere to record an asset disposition, and no
  //    legacy format records servers at all. Comparing intent against that
  //    would report drift — true, but it would send the user hunting for a
  //    disagreement when the real problem is that the file predates the
  //    concept and needs one non-frozen install to migrate.
  const unrepresentable: LockfileDriftEntry[] = []
  for (const name of Object.keys(facets).sort(compareCodeUnits)) {
    const overrides = ownEntry(facets, name)?.overrides
    const needsServers = !SERVER_DISPOSITION_FORMATS.has(lockfileVersion) && countServerOverrides(overrides) > 0
    const needsAssets = !ASSET_DISPOSITION_FORMATS.has(lockfileVersion) && countAssetOverrides(overrides) > 0
    if (!needsServers && !needsAssets) continue
    unrepresentable.push({
      name,
      reason: 'materialization-unrepresentable',
      lockfileVersion,
      // The capability that is actually missing, not the writer version. A
      // facet needing both reports the one that covers both.
      requiredVersion: needsServers ? LOCKFILE_VERSION_0_4 : LOCKFILE_VERSION_0_3,
    })
  }
  if (unrepresentable.length > 0) {
    return { code: 'LOCKFILE_DRIFT', facets: unrepresentable }
  }

  // 3. Plan over the LOCKED contribution set. Frozen mode reproduces what the
  //    lockfile records, so the locked assets and servers — not a fresh
  //    resolution — are the authority for what exists. Reusing the shared
  //    planners means the frozen gate cannot develop its own idea of what
  //    collides. Every manifest facet participates, including one with no
  //    contributions, so its stale overrides are still found.
  const names = Object.keys(facets).sort(compareCodeUnits)
  const assetPlan = planMaterialization(
    names.map(
      (name): FacetContribution => ({
        facet: name,
        assets: (ownEntry(previousLockfile.facets, name)?.assets ?? []).map((asset) => ({
          scope: asset.scope,
          type: asset.type,
          name: asset.name,
        })),
        overrides: ownEntry(facets, name)?.overrides,
      }),
    ),
  )
  // Only `0.4` records servers. A legacy format reaching here carries no
  // server override (the format gate refused those), so there is no server
  // intent to check before fetch — declarations are verified after it.
  const serverPlan = lockedServerPlan(names, facets, previousLockfile)

  const problems: MaterializationAliasProblem[] = [
    ...(!assetPlan.ok && assetPlan.reason === 'invalid-alias'
      ? assetPlan.problems.map(
          (problem): MaterializationAliasProblem => ({
            kind: 'asset',
            facet: problem.facet,
            assetType: problem.type,
            authoredName: problem.authoredName,
            alias: problem.alias,
            reason: problem.reason,
          }),
        )
      : []),
    ...(serverPlan !== null && !serverPlan.ok && serverPlan.reason === 'invalid-alias'
      ? serverPlan.problems.map(
          (problem): MaterializationAliasProblem => ({
            kind: 'mcp-server',
            facet: problem.facet,
            authoredName: problem.authoredName,
            alias: problem.alias,
            reason: problem.reason,
          }),
        )
      : []),
  ]
  if (problems.length > 0) return { code: 'MATERIALIZATION_ALIAS_INVALID', problems }

  // Stale intent from whichever domain still planned, so a collision in one
  // does not hide the other's diagnostics.
  const staleOverrides: StaleMaterializationOverride[] = [
    ...(assetPlan.ok || assetPlan.reason === 'collision'
      ? assetPlan.staleOverrides.map(
          (stale): StaleMaterializationOverride => ({
            facet: stale.facet,
            contribution: { kind: 'asset', assetType: stale.type },
            authoredName: stale.authoredName,
            disposition: stale.disposition,
          }),
        )
      : []),
    ...(serverPlan !== null && (serverPlan.ok || serverPlan.reason === 'collision')
      ? serverPlan.staleOverrides.map(
          (stale): StaleMaterializationOverride => ({
            facet: stale.facet,
            contribution: { kind: 'mcp-server' },
            authoredName: stale.authoredName,
            disposition: stale.disposition,
          }),
        )
      : []),
  ]

  // Unresolved collisions in recorded state, from both identity spaces in one
  // report. Frozen mode never prompts, so this is the same complete report a
  // non-interactive install would get — delivered before anything was
  // downloaded, and naming servers by fingerprint because no declaration has
  // been read.
  const groups: LockedMaterializationCollisionGroup[] = [
    ...(!assetPlan.ok && assetPlan.reason === 'collision'
      ? assetPlan.groups.map((group): LockedMaterializationCollisionGroup => ({ kind: 'asset', group }))
      : []),
    ...(serverPlan !== null && !serverPlan.ok && serverPlan.reason === 'collision'
      ? serverPlan.groups.map((group): LockedMaterializationCollisionGroup => ({ kind: 'mcp-server', group }))
      : []),
  ]
  if (groups.length > 0) return { code: 'LOCKED_MATERIALIZATION_COLLISION', groups, staleOverrides }
  // Every failure arm was handled above, so both planners succeeded. Reaching
  // this with a failed plan is a bug, and passing the gate on it would be the
  // one wrong answer.
  if (!assetPlan.ok || (serverPlan !== null && !serverPlan.ok)) {
    throw new Error('frozen gate invariant: a failed plan reported neither an invalid alias nor a collision')
  }

  // 4. Stale intent. A normal install prunes these inside its transaction;
  //    frozen mode has no transaction to prune in.
  const drift: LockfileDriftEntry[] = staleOverrides.map((stale) => ({
    name: stale.facet,
    reason: 'stale-override' as const,
    contribution: stale.contribution,
    authoredName: stale.authoredName,
  }))

  // 5. Intent vs. recorded disposition, per locked asset and server. Absent
  //    intent means authored: a locked alias the manifest no longer asks for
  //    is drift, not something to keep silently.
  for (const asset of assetPlan.plan.assets) {
    const locked = ownEntry(previousLockfile.facets, asset.facet)?.assets.find(
      (candidate) =>
        candidate.scope === asset.scope && candidate.type === asset.type && candidate.name === asset.authoredName,
    )
    if (locked === undefined) continue
    const lockedDisposition = lockedDispositionOf(locked)
    if (sameDisposition(lockedDisposition, asset.disposition)) continue
    drift.push({
      name: asset.facet,
      reason: 'materialization-drift',
      assetType: asset.type,
      authoredName: asset.authoredName,
      manifest: asset.disposition,
      locked: lockedDisposition,
    })
  }
  if (serverPlan?.ok && previousLockfile.lockfileVersion === LOCKFILE_VERSION_0_4) {
    for (const server of serverPlan.planned) {
      const locked = ownEntry(previousLockfile.facets, server.facet)?.servers.find(
        (candidate) => candidate.name === server.authoredName,
      )
      if (locked === undefined) continue
      if (sameDisposition(locked.materialization, server.disposition)) continue
      drift.push({
        name: server.facet,
        reason: 'server-materialization-drift',
        authoredName: server.authoredName,
        manifest: server.disposition,
        locked: locked.materialization,
      })
    }
  }

  if (drift.length > 0) {
    return { code: 'LOCKFILE_DRIFT', facets: drift }
  }

  return null
}

/** Lockfile formats that record an asset's materialization disposition. */
const ASSET_DISPOSITION_FORMATS: ReadonlySet<SupportedLockfileVersion> = new Set([
  LOCKFILE_VERSION_0_3,
  LOCKFILE_VERSION_0_4,
])

/** Lockfile formats that record a server inventory and its dispositions. */
const SERVER_DISPOSITION_FORMATS: ReadonlySet<SupportedLockfileVersion> = new Set([LOCKFILE_VERSION_0_4])

/**
 * Plan the manifest's server intent over a `0.4` lockfile's complete locked
 * inventory, or `null` for a format that records none.
 *
 * Discriminated on the document's version tag, never on whether an entry
 * happens to carry a `servers` member: a legacy document may hold one as an
 * opaque extension, and that is not an inventory.
 */
function lockedServerPlan(
  names: readonly string[],
  facets: Readonly<Record<string, NormalizedFacetEntry>>,
  previousLockfile: SupportedLockfile,
): PlanLockedServerInventoryResult | null {
  if (previousLockfile.lockfileVersion !== LOCKFILE_VERSION_0_4) return null
  return planLockedServerInventory(
    names.map((name) => ({
      facet: name,
      servers: (ownEntry(previousLockfile.facets, name)?.servers ?? []).map((server) => ({
        name: server.name,
        fingerprint: server.fingerprint,
      })),
      overrides: ownEntry(facets, name)?.overrides,
    })),
  )
}
