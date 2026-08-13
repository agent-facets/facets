import { prepareRemove, type RemovePrepareFailure, type RunRemoveResult, runRemove } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { type CliError, writeCliError } from '../../util/errors.ts'
import { writeInstallFailureDetail } from '../../util/install-detail.ts'
import { canPromptInteractively } from '../../util/interactive.ts'
import { unsupportedManifestVersionError } from '../../util/unsupported-manifest-version.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'
import { ACCEPT_MCP_FLAG, INSTALL_PIPELINE_FLAGS, mcpConsentPolicy } from '../shared/flags.ts'
import { installFailureDetail, installFailureFix } from '../shared/install-failure.ts'

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
  flags: INSTALL_PIPELINE_FLAGS,
  run: async (args, flags) => {
    if (args.length === 0) {
      writeCliError({
        what: 'missing facet name',
        detail: 'facet remove requires at least one facet name',
        fix: 'run: facet remove <facet>    (e.g. facet remove viper-plans)',
      })
      return 1
    }

    const verbose = flags.verbose === true
    const acceptMcp = flags[ACCEPT_MCP_FLAG] === true

    const names = args
    const projectRoot = process.cwd()

    // Validate that `facets.json` can be read BEFORE discovering adapters, so
    // a missing or unsupported manifest fails with the facet error rather
    // than "no adapters installed" (the contract per the CLI spec's "Remove
    // reports an undeclared facet clearly"). That is all this read decides:
    // it deliberately learns nothing about WHICH names are declared, because
    // anything it learned would be a pre-lock snapshot, and acting on one is
    // how a facet declared by a concurrent add survives the removal that
    // asked for it.
    const prepared = prepareRemove({ projectRoot, names })
    if (!prepared.ok) {
      writePrepareError(prepared.failure)
      return 1
    }

    // Discover or pick adapters. Drift-removal calls `deleteAsset` on each
    // selected adapter, so removal needs installable adapters just like add —
    // including when every requested name LOOKED absent a moment ago, because
    // only the commit, under the lock, can know whether it still is.
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
      process.stderr.write('\nInterrupted. Stopping safely...\n')
      controller.abort()
    }
    process.on('SIGINT', sigintHandler)

    const mayPrompt = canPromptInteractively()

    let captured: RunRemoveResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'remove',
        signal: controller.signal,
        run: async ({ onStage, onLog, resolveCollisions, resolveMcpConsent, resolveAssetTakeover }) => {
          const result = await runRemove({
            projectRoot,
            names,
            adapters,
            prepared,
            onStage,
            mcpConsent: mcpConsentPolicy({ acceptMcp, mayPrompt, resolve: resolveMcpConsent }),
            ...(verbose ? { onLog } : {}),
            ...(mayPrompt ? { resolveCollisions, resolveAssetTakeover } : {}),
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
    writeInstallFailureDetail(captured.install.failure, captured.install.rollback)
    writeCliError({
      what: 'remove failed',
      detail: installFailureDetail(captured.install.failure),
      fix: installFailureFix(captured.install.failure, captured.install.rollback, 'remove'),
    })
    return 1
  },
}

/**
 * Map a `RemovePrepareFailure` (engine) to the canonical CLI error block
 * on stderr. The view already rendered a richer block on stdout; this
 * keeps stderr grep-friendly and gives each failure a precise fix line.
 *
 * Returns the error rather than writing it, so the `switch` has to produce a
 * value and an unhandled variant becomes a compile error instead of silently
 * printing nothing.
 */
export function removePrepareCliError(failure: RemovePrepareFailure): CliError {
  switch (failure.reason) {
    case 'manifest-read':
      return {
        what: 'could not read facets.json',
        detail: failure.error,
        fix: 'run this command inside a project with a valid facets.json',
      }
    case 'manifest-unsupported-version':
      return unsupportedManifestVersionError(failure)
  }
}

function writePrepareError(failure: RemovePrepareFailure): void {
  writeCliError(removePrepareCliError(failure))
}
