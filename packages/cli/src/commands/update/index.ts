import { isNonEmpty } from '@agent-facets/common'
import {
  type FacetUpdateSelection,
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
import { canPromptInteractively, canRenderLiveOutput, currentTerminalCapabilities } from '../../util/interactive.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'
import { ACCEPT_MCP_FLAG, INSTALL_PIPELINE_FLAGS, mcpConsentPolicy } from '../shared/flags.ts'
import { installFailureDetail, installFailureFix } from '../shared/install-failure.ts'
import { updatePrepareCliError, updateSelectionCliError } from './errors.ts'
import { buildUpdateErrorJson, buildUpdateJson, type UpdateDocument, type UpdateErrorDocument } from './json.ts'
import { buildPreview } from './preview.ts'
import { withUpdateDiscovery } from './run-discovery.ts'
import { runUpdatePicker } from './run-picker.ts'
import { candidateRows, classifyNoOp, defaultSelections, describeNoOp, type UpdateMode } from './selection.ts'

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
    json: { type: 'boolean', description: 'Emit machine-readable JSON to stdout instead of the plan view' },
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
    const json = flags.json === true

    // This has to come before the terminal check below, not after it.
    // Both are true for `facet update --json --interactive` in CI, and
    // whichever runs first is the one the user reads. "needs an
    // interactive terminal" would be the wrong answer there: the run is
    // refused because the two flags contradict each other, and it would
    // still be refused on the nicest terminal in the world.
    if (json && interactive) {
      writeCliError({
        what: 'facet update --json cannot be combined with --interactive',
        detail: 'the picker writes to stdout, which would corrupt the JSON document',
        fix: "run 'facet update --json --dry-run' to see what would change without prompting",
      })
      return 1
    }

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
    //
    // The indicator is a second Ink writer and it is on by default on a
    // live terminal, so `--json` has to switch it off explicitly or its
    // frames land on stdout in front of the document.
    //
    // ANDed with the usual live-output rule rather than replacing it.
    // `enabled` is read with `??`, so a bare `!json` would be `true` for
    // every ordinary run and force the indicator on where it is normally
    // off — piped to a file, or in CI — which is the exact leak the
    // default exists to prevent. This only ever turns the indicator off.
    const prepared = await withUpdateDiscovery(() => prepareFacetUpdate({ projectRoot: process.cwd() }), {
      enabled: !json && canRenderLiveOutput(currentTerminalCapabilities()),
    })
    if (!prepared.ok) {
      const error = updatePrepareCliError(prepared.failure)
      if (json) {
        // The document replaces the report, never the exit code: a
        // caller that only checked `$?` must still see this fail.
        writeJsonDocument(buildUpdateErrorJson(error))
        return 1
      }
      writeCliError(error)
      return 1
    }
    const { plan } = prepared.prepared

    // What a run with no user in it takes. Interactive mode never uses
    // this: the picker opens with nothing selected and every choice is
    // made on screen, so `--latest` has nothing left to say there.
    const defaults = defaultSelections(plan, mode)

    // A run that applies nothing still succeeded. Which KIND of nothing
    // it is decides whether the user has anything to do about it, so the
    // message says which one rather than a single "nothing to update".
    //
    // What counts as nothing depends on the mode. A non-interactive run
    // has only its mode's default selection to go on. An interactive run
    // has the picker, which can reach a version those defaults did not
    // select — so its only dead end is a plan with no candidate row to
    // put on screen at all. Narrowing to a non-empty candidate list here
    // is what proves that: the picker below cannot be handed a list it
    // has no cursor position for.
    const candidates = candidateRows(plan)
    const picking = interactive && isNonEmpty(candidates) ? candidates : null

    const noOp = picking === null ? classifyNoOp(plan, mode, interactive ? [] : defaults) : null
    if (noOp !== null) {
      // JSON says which nothing this is without the prose: every row
      // carries its own outcome, so a parser can read the conclusion off
      // the document. One document whether or not `--dry-run` was
      // passed — the terse/verbose split below is a reading affordance
      // for humans, and a script wants the rows either way.
      if (json) {
        writeJsonDocument(buildUpdateJson({ plan, mode, applied: false }))
        return 0
      }

      // A dry run was asked for the plan, and "nothing to do" is a
      // conclusion drawn FROM the plan. The reason alone asks the user to
      // take that conclusion on faith; the rows it was drawn from let
      // them check it — which facet is pinned, which is already current,
      // which range is holding one back. Rendered with nothing selected
      // and no rewrites, because that is precisely what this run would
      // apply. An ordinary run stays terse: there is no plan to review
      // when nothing was going to happen either way.
      if (dryRun) renderPlan(plan, [], [])
      process.stdout.write(`${describeNoOp(noOp)}\n`)
      return 0
    }

    let selections: readonly FacetUpdateSelection[] = defaults
    if (picking !== null) {
      // Before adapters, before the lock, before anything that writes:
      // cancelling here must cost the user nothing at all.
      const outcome = await runUpdatePicker(picking)
      if (outcome.kind === 'cancelled') {
        process.stdout.write('Update cancelled. Nothing was applied.\n')
        return 1
      }
      if (outcome.kind === 'unavailable') {
        writeCliError({
          what: 'the update selection screen could not be shown',
          detail: outcome.cause,
          fix: "run 'facet update' or 'facet update --latest' to apply updates without prompting",
        })
        return 1
      }
      selections = outcome.selections
    }

    // The engine derives what each choice installs and what it would
    // write to facets.json. Doing it here would give the preview its own
    // opinion, and the preview is the thing a user approves.
    const validated = validateFacetUpdateSelections(plan, selections)
    if (!validated.ok) {
      const error = updateSelectionCliError(validated.failure)
      if (json) {
        writeJsonDocument(buildUpdateErrorJson(error))
        return 1
      }
      writeCliError(error)
      return 1
    }

    if (dryRun) {
      // `mode` is the one the run selected, passed through rather than
      // worked out again here, so the document cannot describe a
      // different run from the one that produced the plan.
      if (json) {
        writeJsonDocument(buildUpdateJson({ plan, mode, applied: false }))
        return 0
      }
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
          // A selection failure has no install result to render, but it
          // is still an outcome this driver produced. Returned rather
          // than thrown: the engine refusing a selection is a documented
          // way for this command to end, and the view's result type says
          // so. It is reported on stderr after unmount, where its remedy
          // lives.
          return { ok: false, updateSelectionFailure: result.failure }
        },
        onComplete: () => {
          // `captured` is already the richer result, set inside `run`.
        },
      }),
      // See `install`: Ctrl-C has to reach the workspace so the engine's
      // pending resolver call is settled and the lock released.
      { exitOnCtrlC: false },
    )

    // Not wrapped in `catch`: every outcome this command has is a value
    // the driver returned, so a rejection here is the view or the driver
    // failing in a way nothing modelled. It propagates, and the CLI's
    // top level reports it as an unexpected failure instead of this
    // command reporting a plausible-looking one it made up.
    try {
      await instance.waitUntilExit()
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
 * Write one document to stdout and nothing else.
 *
 * Every `--json` exit goes through here so the promise `--json` makes —
 * one parseable document on stdout, no prose around it — is kept in one
 * place rather than re-honoured at four call sites.
 */
function writeJsonDocument(document: UpdateDocument | UpdateErrorDocument): void {
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
}

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
