import { prepareRemove, type RemovePrepareFailure, type RunRemoveResult, runRemove } from '@agent-facets/engine'
import { Box, render, Text } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { THEME } from '../../tui/theme.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'

/**
 * `facet remove <facet> [more facets...]` — removes one or more facets
 * from `facets.json` and uninstalls them in a single operation.
 *
 * This command is a thin caller over the engine `remove` orchestrator
 * (`runRemove`), which owns the manifest transaction: validate every name
 * is declared, snapshot `facets.json`, remove the entries, run the install
 * pipeline (whose drift-removal deletes the facets' assets and rewrites
 * the lockfile), and restore the snapshot on failure. This file only
 * parses argv, ensures adapters, renders progress, and maps the result to
 * an exit code + error block.
 */
export const removeCommand: Command = {
  name: 'remove',
  description: 'Remove a facet from facets.json and uninstall it',
  usage: '<facet> [more facets...]',
  aliases: ['rm'],
  implemented: true,
  flags: {
    verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
  },
  run: async (args, flags) => {
    if (args.length === 0) {
      writeCliError({
        what: 'missing facet name',
        detail: 'facet remove requires at least one facet name',
        fix: 'run: facet remove <facet>    (e.g. facet remove viper-plans)',
      })
      return 1
    }

    const startTime = performance.now()
    const verbose = flags.verbose === true

    const names = args
    const projectRoot = process.cwd()

    // Validate the manifest + names BEFORE discovering adapters. An
    // undeclared facet or missing manifest must fail with the facet error
    // and leave the project untouched — never launching the adapter picker
    // or reporting "no adapters installed" (the contract per the CLI spec's
    // "Remove reports an undeclared facet clearly"). The validated result is
    // threaded into `runRemove` so validation runs exactly once.
    const prepared = prepareRemove({ projectRoot, names })
    if (!prepared.ok) {
      writePrepareError(prepared.failure)
      return 1
    }

    // If every requested name was absent from facets.json, there is nothing
    // to remove. Print the no-op summary and exit without discovering
    // adapters — avoids a misleading "no adapters installed" error when the
    // user removes a facet that was never declared.
    if (prepared.names.length === 0) {
      const facetCount = Object.keys(prepared.json.facets).length
      const elapsed = `${((performance.now() - startTime) / 1000).toFixed(2)}s`
      const instance = render(
        createElement(
          Box,
          null,
          createElement(
            Text,
            null,
            'Checked ',
            createElement(Text, { color: THEME.success }, facetCount),
            ` facet${facetCount === 1 ? '' : 's'} `,
            createElement(Text, { color: THEME.hint }, '(no changes)'),
            ' ',
            createElement(Text, { color: THEME.hint }, `[${elapsed}]`),
          ),
        ),
      )
      instance.unmount()
      return 0
    }

    // Discover or pick adapters. Drift-removal calls `deleteAsset` on each
    // selected adapter, so removal needs installable adapters just like add.
    const adapters = await ensureAdapters()
    if (adapters === null) {
      // ensureAdapters already wrote the appropriate CLI error.
      return 1
    }

    // Wire SIGINT to an AbortController so engine never installs a
    // process-global signal handler. The view's deferred-exit pattern
    // ensures the rollback render lands before unmount.
    const controller = new AbortController()
    const sigintHandler = () => {
      process.stderr.write('\nInterrupted. Rolling back...\n')
      controller.abort()
    }
    process.on('SIGINT', sigintHandler)

    let captured: RunRemoveResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'remove',
        run: async (onStage, onLog) => {
          const result = await runRemove({
            projectRoot,
            names,
            adapters,
            prepared,
            onStage,
            ...(verbose && onLog ? { onLog } : {}),
            signal: controller.signal,
          })
          captured = result
          // The view renders from a RunInstallResult-shaped value. Map
          // runRemove's result into what the view expects: install success
          // and install failures pass through verbatim; a prepare-phase
          // failure surfaces via the dedicated remove prepare-failure arm.
          if (result.ok) return result.install
          if (result.phase === 'install') return result.install
          return { ok: false, removePrepareFailure: result.failure }
        },
        onComplete: (r) => {
          // `onComplete` receives the view-shaped result; `captured` is
          // already the richer RunRemoveResult set in `run`.
          void r
        },
      }),
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
        what: 'remove failed',
        detail: 'the remove pipeline returned no result',
        fix: 'this is a bug; please file an issue with the verbose log',
      })
      return 1
    }

    if (captured.ok) return 0

    if (captured.phase === 'prepare') {
      writePrepareError(captured.failure)
      return 1
    }

    // Install-phase failure. The delta-based flow never writes the manifest
    // ahead of install — the journal rollback handles asset cleanup.
    const rollback = captured.install.rollback
    const partialFailureCount = rollback.kind === 'partial-failure' ? rollback.failures : 0
    writeCliError({
      what: 'remove failed',
      detail: `code=${captured.install.failure.code}`,
      fix:
        partialFailureCount > 0
          ? "partial rollback: some state may remain. Inspect and clean manually before re-running 'facet remove'."
          : "rollback complete; project state unchanged. Fix the underlying issue and re-run 'facet remove'.",
    })
    return 1
  },
}

/**
 * Map a `RemovePrepareFailure` (engine) to the canonical CLI error block
 * on stderr. The view already rendered a richer block on stdout; this
 * keeps stderr grep-friendly and gives each failure a precise fix line.
 */
function writePrepareError(failure: RemovePrepareFailure): void {
  switch (failure.reason) {
    case 'manifest-read':
      writeCliError({
        what: 'could not read facets.json',
        detail: failure.error,
        fix: 'run this command inside a project with a valid facets.json',
      })
      return
  }
}
