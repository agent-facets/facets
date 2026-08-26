import {
  prepareFacetUpdate,
  type RunPreparedFacetUpdateResult,
  runPreparedFacetUpdate,
  validateFacetUpdateSelections,
} from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { UpdatePlanView } from '../../tui/views/update/plan-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { writeInstallFailureDetail } from '../../util/install-detail.ts'
import { canPromptInteractively } from '../../util/interactive.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'
import { ACCEPT_MCP_FLAG, INSTALL_PIPELINE_FLAGS, mcpConsentPolicy } from '../shared/flags.ts'
import { installFailureDetail, installFailureFix } from '../shared/install-failure.ts'
import { updatePrepareCliError, updateSelectionCliError } from './errors.ts'
import { buildPreview } from './preview.ts'
import { withUpdateDiscovery } from './run-discovery.ts'
import { runUpdatePicker } from './run-picker.ts'
import {
  classifyNoOp,
  defaultSelections,
  describeNoOp,
  hasSelectableCandidate,
  type UpdateMode,
  type UpdateNoOp,
} from './selection.ts'

/**
 * `facet update` (alias: `facet upgrade`) — move the project's
 * registry-backed facets to newer releases.
 *
 * Deliberately not `self-update`: this command changes the facets a
 * project declares, and never the CLI binary. The two live one keystroke
 * apart, so both help texts say which is which.
 *
 * The work is split in two by the engine. `prepareFacetUpdate` resolves
 * every facet's range target and the registry's latest release without
 * taking the project lock, so a user can read the plan — or an
 * automation can print it — without blocking every other facet operation
 * on the machine. `runPreparedFacetUpdate` then applies the reviewed
 * choices through the ordinary install transaction, re-checking under
 * the lock that the project has not moved in the meantime.
 *
 * This file owns only the order those happen in, and it matters: nothing
 * that could install an adapter, take a lock, or write a file may run
 * before the user has confirmed a selection they can still cancel.
 */
export const updateCommand: Command = {
  name: 'update',
  aliases: ['upgrade'],
  description: 'Update the facets this project declares (see self-update for the CLI itself)',
  implemented: true,
  flags: {
    ...INSTALL_PIPELINE_FLAGS,
    latest: {
      type: 'boolean',
      short: 'L',
      description: "Update to each facet's latest release, ignoring the range in facets.json",
    },
    interactive: {
      type: 'boolean',
      short: 'i',
      description: 'Choose which facets to update, and which version each one takes',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print the plan; do not modify any files',
    },
  },
  run: async (args, flags) => {
    // No positional filter yet — interactive selection is how a user
    // updates some facets but not others, so say that rather than
    // rejecting the argument with nothing to offer instead.
    if (args.length > 0) {
      writeCliError({
        what: `facet update does not accept positional arguments (got "${args[0]}")`,
        detail: 'update considers every facet declared in facets.json',
        fix: "run 'facet update --interactive' to choose which facets to update",
      })
      return 1
    }

    const interactive = flags.interactive === true

    // Checked before discovery on purpose: a user who asked to pick from
    // a list should not wait through every registry lookup to be told the
    // list can never be shown.
    if (interactive && !canPromptInteractively()) {
      writeCliError({
        what: 'facet update --interactive needs an interactive terminal',
        detail: 'this environment cannot prompt, so the selection screen cannot run here',
        fix: "run 'facet update' or 'facet update --latest' to apply updates without prompting",
      })
      return 1
    }

    const dryRun = flags['dry-run'] === true
    const mode: UpdateMode = flags.latest === true ? 'latest' : 'range'

    // Wrapped rather than awaited bare: discovery is the long, silent
    // part of this command, and an empty screen while it runs is
    // indistinguishable from a command that did nothing.
    const prepared = await withUpdateDiscovery(() => prepareFacetUpdate({ projectRoot: process.cwd() }))
    if (!prepared.ok) {
      writeCliError(updatePrepareCliError(prepared.failure))
      return 1
    }
    const { plan } = prepared.prepared

    // The mode's own answer, before the user gets a say. In interactive
    // mode this is only the starting position of the picker; otherwise it
    // is the selection.
    const defaults = defaultSelections(plan, mode)

    // A run that applies nothing still succeeded. Which KIND of nothing
    // it is decides whether the user has anything to do about it, so the
    // message says which one rather than a single "nothing to update".
    //
    // What counts as nothing depends on the mode. A non-interactive run
    // has only its mode's default selection to go on. An interactive run
    // has the picker, which can reach a version those defaults did not
    // select — so its only dead end is a plan with no candidate row to
    // put on screen at all.
    let noOp: UpdateNoOp | null
    if (interactive) {
      noOp = hasSelectableCandidate(plan) ? null : classifyNoOp(plan, mode, [])
    } else {
      noOp = classifyNoOp(plan, mode, defaults)
    }
    if (noOp !== null) {
      process.stdout.write(`${describeNoOp(noOp)}\n`)
      return 0
    }

    let selections = defaults
    if (interactive) {
      // Before adapters, before the lock, before anything that writes:
      // cancelling here must cost the user nothing at all.
      const outcome = await runUpdatePicker(plan, mode)
      if (outcome.kind === 'cancelled') {
        process.stdout.write('Update cancelled. Nothing was applied.\n')
        return 1
      }
      selections = outcome.selections
    }

    // The engine derives what each choice installs and what it would
    // write to facets.json. Doing it here would give the preview its own
    // opinion, and the preview is the thing a user approves.
    const validated = validateFacetUpdateSelections(plan, selections)
    if (!validated.ok) {
      writeCliError(updateSelectionCliError(validated.failure))
      return 1
    }

    if (dryRun) {
      renderPlan(plan, selections, validated.selections)
      return 0
    }

    // Only now: adapters can trigger a picker and an install of their
    // own, which is a side effect a preview or a cancellation must never
    // have paid for.
    const adapters = await ensureAdapters()
    if (adapters === null) {
      // ensureAdapters already wrote the appropriate CLI error.
      return 1
    }

    const verbose = flags.verbose === true
    const acceptMcp = flags[ACCEPT_MCP_FLAG] === true
    const mayPrompt = canPromptInteractively()

    // SIGINT reaches the engine as an abort rather than killing the
    // process, so a run interrupted mid-write unwinds through its own
    // rollback and releases the project lock.
    const controller = new AbortController()
    const sigintHandler = () => {
      process.stderr.write('\nInterrupted. Stopping safely...\n')
      controller.abort()
    }
    process.on('SIGINT', sigintHandler)

    let captured: RunPreparedFacetUpdateResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'update',
        signal: controller.signal,
        run: async ({ onStage, onLog, resolveCollisions, resolveMcpConsent, resolveAssetTakeover }) => {
          const result = await runPreparedFacetUpdate({
            prepared: prepared.prepared,
            selections,
            adapters,
            onStage,
            mcpConsent: mcpConsentPolicy({ acceptMcp, mayPrompt, resolve: resolveMcpConsent }),
            ...(verbose ? { onLog } : {}),
            ...(mayPrompt ? { resolveCollisions, resolveAssetTakeover } : {}),
            signal: controller.signal,
          })
          captured = result
          if (result.ok) return result.install
          if (result.phase === 'install') return result.install
          // A selection failure has no install result to render. It is
          // reported on stderr after unmount, where its remedy lives.
          throw new UpdateSelectionRejected()
        },
        onComplete: () => {
          // `captured` is already the richer result, set inside `run`.
        },
      }),
      // See `install`: Ctrl-C has to reach the workspace so the engine's
      // pending resolver call is settled and the lock released.
      { exitOnCtrlC: false },
    )

    try {
      await instance.waitUntilExit()
    } catch {
      // Ink rejects on view-level failure; we have the captured result.
    } finally {
      process.off('SIGINT', sigintHandler)
    }

    if (!captured) {
      writeCliError({
        what: 'update failed',
        detail: 'the update pipeline returned no result',
        fix: 'this is a bug; please file an issue with the verbose log',
      })
      return 1
    }

    if (captured.ok) return 0

    if (captured.phase === 'selection') {
      writeCliError(updateSelectionCliError(captured.failure))
      return 1
    }

    writeInstallFailureDetail(captured.install.failure, captured.install.rollback)
    writeCliError({
      what: 'update failed',
      detail: installFailureDetail(captured.install.failure),
      fix: installFailureFix(captured.install.failure, captured.install.rollback, 'update'),
    })
    return 1
  },
}

/**
 * Unmounts the view when the engine refuses the selection.
 *
 * The view renders `RunInstallResult`-shaped values and a selection
 * failure is not one. Throwing ends the mount; the structured failure is
 * already captured and is reported on stderr by the caller.
 */
class UpdateSelectionRejected extends Error {}

/** Draw the plan once and tear the mount down; nothing here is live. */
function renderPlan(
  plan: Parameters<typeof buildPreview>[0],
  selections: Parameters<typeof buildPreview>[1],
  validated: Parameters<typeof buildPreview>[2],
): void {
  const { selected, rewrites } = buildPreview(plan, selections, validated)
  const instance = render(createElement(UpdatePlanView, { plan, selected, rewrites }))
  instance.unmount()
}
