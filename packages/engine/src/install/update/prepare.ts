/**
 * Phase one of updating: work out what could change, touching nothing.
 *
 * Preparation deliberately runs without the project install lock. A user
 * reading an interactive picker, or an automation printing a dry run,
 * should not hold machine-wide lock state for as long as they take to
 * decide — and a preview that created lock infrastructure would not be
 * much of a preview. The cost of staying lock-free is that the project
 * can move underneath a plan, which is why the exact bytes both files
 * were read at travel with the plan and get checked again before
 * anything is written.
 */

import { fileStatesEqual } from '@agent-facets/common'
import { loadProjectManifest, manifestLoadFailure } from '../../manifest/project-files.ts'
import { loadLockfile } from '../lockfile-io.ts'
import { discoverUpdates, type ResolveMetadataBatch } from './discover.ts'
import type { PrepareFacetUpdateResult } from './types.ts'

export interface PrepareFacetUpdateArgs {
  projectRoot: string
  /** Injectable batch resolver; defaults to the real registry client. */
  resolve?: ResolveMetadataBatch
}

/**
 * Load the project, resolve every registry facet's choices, and return a
 * plan bound to the state it was built from.
 *
 * The installed version of each facet is read from the lockfile and
 * never re-resolved. Update does not ask the registry whether what you
 * already have still exists: a yanked release is a real situation that
 * `facet install` is responsible for, and treating it as an update
 * precondition would turn one command into a second drift repairer.
 *
 * Performs no writes of any kind — no downloads, no cache population, no
 * adapter installation or selection, no lock directory, and no change to
 * the manifest, lockfile, receipt, materialized assets, or native
 * configuration.
 */
export async function prepareFacetUpdate(args: PrepareFacetUpdateArgs): Promise<PrepareFacetUpdateResult> {
  const { projectRoot } = args

  const manifest = loadProjectManifest(projectRoot)
  if (!manifest.ok) return { ok: false, failure: manifestLoadFailure(projectRoot, manifest) }

  const lockfile = loadLockfile(projectRoot)
  if (!lockfile.ok) return { ok: false, failure: { reason: 'lockfile-read', error: lockfile.error } }

  const discovered = await discoverUpdates({
    facets: manifest.manifest.facets,
    lockfile: lockfile.parsed.lockfile,
    ...(args.resolve ? { resolve: args.resolve } : {}),
  })
  if (!discovered.ok) return { ok: false, failure: discovered.failure }

  // Re-read both files now that the network round trip is over. A change
  // during discovery means the plan describes a project that no longer
  // exists, and the honest move is to withdraw it rather than show the
  // user choices derived from bytes someone has already replaced.
  const manifestAfter = loadProjectManifest(projectRoot)
  if (!manifestAfter.ok) return { ok: false, failure: manifestLoadFailure(projectRoot, manifestAfter) }
  if (!fileStatesEqual(manifest.state, manifestAfter.state)) {
    return { ok: false, failure: { reason: 'project-changed-during-discovery', file: 'manifest' } }
  }

  const lockfileAfter = loadLockfile(projectRoot)
  if (!lockfileAfter.ok) return { ok: false, failure: { reason: 'lockfile-read', error: lockfileAfter.error } }
  if (!fileStatesEqual(lockfile.state, lockfileAfter.state)) {
    return { ok: false, failure: { reason: 'project-changed-during-discovery', file: 'lockfile' } }
  }

  return {
    ok: true,
    prepared: {
      projectRoot,
      plan: discovered.plan,
      manifestState: manifest.state,
      lockfileState: lockfile.state,
    },
  }
}
