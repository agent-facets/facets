/**
 * Phase two of updating: turn reviewed choices into one install.
 *
 * The split from `prepareFacetUpdate` is what lets a user read an
 * interactive screen without holding the project lock. This half takes
 * the plan they were shown plus what they picked, checks that the picks
 * are answerable from that plan, and hands the install transaction an
 * operation bound to the bytes the plan was built from.
 *
 * No registry question is asked here. Discovery already asked, and the
 * answer it got is the one the user approved.
 */

import type { Adapter } from '@agent-facets/adapter'
import { isNonEmpty } from '@agent-facets/common'
import { describeVersionSpec } from '../../registry/describe.ts'
import { runInstall } from '../run-install.ts'
import type { MutationInteractions, OnLog, RunInstallResult, SelectedFacetUpdate, StageEvent } from '../types.ts'
import { advancingChoice, displayedVersion } from './advancing.ts'
import { finalManifestSource, type UpdateChoice } from './manifest-source.ts'
import type { PreparedFacetUpdate, UpdatePlanRow } from './types.ts'

/** One facet the caller wants moved, and which of its choices to take. */
export interface FacetUpdateSelection {
  facetName: string
  choice: UpdateChoice
}

/**
 * Why a selection could not be applied.
 *
 * Every arm is something the caller asked for that the reviewed plan
 * cannot answer, so each names the facet and what was wrong with the
 * request rather than describing engine state.
 */
export type UpdateSelectionFailure =
  | { reason: 'empty-selection' }
  | { reason: 'duplicate-facet'; facet: string }
  | { reason: 'unknown-facet'; facet: string }
  | { reason: 'unsupported-source'; facet: string; sourceKind: 'git' | 'local' }
  | { reason: 'not-a-candidate'; facet: string }
  | { reason: 'choice-does-not-advance'; facet: string; choice: UpdateChoice; version: string; current: string }

export type RunPreparedFacetUpdateResult =
  | { ok: true; install: Extract<RunInstallResult, { ok: true }> }
  | { ok: false; phase: 'selection'; failure: UpdateSelectionFailure }
  | { ok: false; phase: 'install'; install: Extract<RunInstallResult, { ok: false }> }

export interface RunPreparedFacetUpdateOptions extends MutationInteractions {
  prepared: PreparedFacetUpdate
  selections: ReadonlyArray<FacetUpdateSelection>
  adapters: ReadonlyArray<Adapter>
  onStage?: (event: StageEvent) => void
  onLog?: OnLog
  signal?: AbortSignal
}

/**
 * Apply reviewed updates through the ordinary install transaction.
 *
 * Never throws. Selection problems and install failures are separate
 * arms because they need different remedies: one means the request was
 * wrong, the other means the project or the network was.
 */
export async function runPreparedFacetUpdate(
  opts: RunPreparedFacetUpdateOptions,
): Promise<RunPreparedFacetUpdateResult> {
  const { prepared, adapters, selections, onStage, onLog, signal, ...interactions } = opts

  const validated = validateFacetUpdateSelections(prepared.plan, selections)
  if (!validated.ok) return { ok: false, phase: 'selection', failure: validated.failure }

  const install = await runInstall({
    projectRoot: prepared.projectRoot,
    adapters,
    operation: {
      kind: 'update',
      snapshot: { manifestState: prepared.manifestState, lockfileState: prepared.lockfileState },
      selections: validated.selections,
      ...interactions,
    },
    ...(onStage ? { onStage } : {}),
    ...(onLog ? { onLog } : {}),
    ...(signal ? { signal } : {}),
  })

  if (!install.ok) return { ok: false, phase: 'install', install }
  return { ok: true, install }
}

/**
 * Check every selection against the plan the user was shown, and derive
 * what each one commits.
 *
 * Both halves happen here rather than in the CLI so a dry run and a real
 * application cannot disagree about what a choice means. A preview that
 * computed its own manifest value would be describing a different
 * operation than the one that runs.
 */
export function validateFacetUpdateSelections(
  plan: readonly UpdatePlanRow[],
  selections: ReadonlyArray<FacetUpdateSelection>,
):
  | { ok: true; selections: readonly [SelectedFacetUpdate, ...SelectedFacetUpdate[]] }
  | {
      ok: false
      failure: UpdateSelectionFailure
    } {
  const resolved: SelectedFacetUpdate[] = []
  const seen = new Set<string>()

  for (const selection of selections) {
    if (seen.has(selection.facetName)) {
      return { ok: false, failure: { reason: 'duplicate-facet', facet: selection.facetName } }
    }
    seen.add(selection.facetName)

    const row = plan.find((candidate) =>
      candidate.kind === 'unsupported-source'
        ? candidate.name === selection.facetName
        : candidate.facet.name === selection.facetName,
    )
    if (row === undefined) {
      return { ok: false, failure: { reason: 'unknown-facet', facet: selection.facetName } }
    }
    if (row.kind === 'unsupported-source') {
      return {
        ok: false,
        failure: { reason: 'unsupported-source', facet: selection.facetName, sourceKind: row.sourceKind },
      }
    }
    if (row.kind === 'current') {
      return { ok: false, failure: { reason: 'not-a-candidate', facet: selection.facetName } }
    }

    // The same predicate the picker gates selection on and the mode
    // defaults are drawn from. Asking it here rather than re-comparing
    // the versions is what makes "selectable" and "acceptable" one fact:
    // applying a choice that does not advance would reinstall the same
    // release under the banner of an update, or move the project
    // backwards if the registry's answer regressed.
    const chosen = advancingChoice(row.facet, selection.choice)
    if (chosen === undefined) {
      return {
        ok: false,
        failure: {
          reason: 'choice-does-not-advance',
          facet: selection.facetName,
          choice: selection.choice,
          version: describeVersionSpec(displayedVersion(row.facet, selection.choice)),
          current: describeVersionSpec(row.facet.current),
        },
      }
    }

    resolved.push({
      facetName: selection.facetName,
      metadata: chosen.metadata,
      manifestSource: finalManifestSource({
        authored: row.facet.authored,
        choice: selection.choice,
        selected: chosen.version,
      }),
    })
  }

  if (!isNonEmpty(resolved)) {
    return { ok: false, failure: { reason: 'empty-selection' } }
  }
  return { ok: true, selections: resolved }
}
