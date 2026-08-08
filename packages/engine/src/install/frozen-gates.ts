import {
  type FacetContribution,
  LOCKFILE_VERSION_0_3,
  lockedDispositionOf,
  planMaterialization,
  type SupportedLockfile,
  type SupportedLockfileVersion,
  sameDisposition,
} from '@agent-facets/protocol'
import { countOverrides, type NormalizedFacetEntry } from '../manifest/mutations.ts'
import { detectLockfileDrift } from './detect-lockfile-drift.ts'
import { ownEntry } from './own-entry.ts'
import type { LockfileDriftEntry, RunInstallFailure } from './types.ts'

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

  // 2. Format. A `0.2` lockfile has no place to record a disposition, so
  //    every asset in it reads as authored. Comparing an alias against that
  //    would report drift — true, but it would send the user hunting for a
  //    disagreement when the real problem is that this lockfile predates the
  //    concept and needs one non-frozen install to migrate.
  if (lockfileVersion !== LOCKFILE_VERSION_0_3) {
    const unrepresentable: LockfileDriftEntry[] = []
    for (const [name, entry] of Object.entries(facets)) {
      if (countOverrides(entry.overrides) === 0) continue
      unrepresentable.push({
        name,
        reason: 'materialization-unrepresentable',
        lockfileVersion,
        requiredVersion: LOCKFILE_VERSION_0_3,
      })
    }
    if (unrepresentable.length > 0) {
      return { code: 'LOCKFILE_DRIFT', facets: unrepresentable }
    }
  }

  // 3. Plan over the LOCKED asset set. Frozen mode reproduces what the
  //    lockfile records, so the locked assets — not a fresh resolution — are
  //    the authority for what exists. Reusing the shared planner means the
  //    frozen gate cannot develop its own idea of what collides.
  const contributions: FacetContribution[] = Object.keys(facets)
    .sort()
    .map((name) => ({
      facet: name,
      assets: (ownEntry(previousLockfile.facets, name)?.assets ?? []).map((asset) => ({
        scope: asset.scope,
        type: asset.type,
        name: asset.name,
      })),
      overrides: ownEntry(facets, name)?.overrides,
    }))

  const planned = planMaterialization(contributions)
  if (!planned.ok) {
    if (planned.reason === 'invalid-alias') {
      return {
        code: 'MATERIALIZATION_ALIAS_INVALID',
        problems: planned.problems.map((p) => ({ facet: p.facet, alias: p.alias, reason: p.reason })),
      }
    }
    // Unresolved collisions in recorded state. Frozen mode never prompts, so
    // this is the same complete report a non-interactive install would get —
    // just delivered before anything was downloaded.
    return {
      code: 'MATERIALIZATION_COLLISION',
      groups: planned.groups.map((group) => ({ kind: 'asset' as const, group })),
      staleOverrides: planned.staleOverrides.map((stale) => ({
        facet: stale.facet,
        contribution: { kind: 'asset', assetType: stale.type },
        authoredName: stale.authoredName,
        disposition: stale.disposition,
      })),
    }
  }

  // 4. Stale intent. A normal install prunes these inside its transaction;
  //    frozen mode has no transaction to prune in.
  const drift: LockfileDriftEntry[] = planned.staleOverrides.map((stale) => ({
    name: stale.facet,
    reason: 'stale-override' as const,
    contribution: { kind: 'asset', assetType: stale.type },
    authoredName: stale.authoredName,
  }))

  // 5. Intent vs. recorded disposition, per locked asset.
  for (const asset of planned.plan.assets) {
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

  if (drift.length > 0) {
    return { code: 'LOCKFILE_DRIFT', facets: drift }
  }

  return null
}
