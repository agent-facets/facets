import { type RollbackOutcome, type RunInstallFailure, type RunInstallResult, runInstall } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'

/**
 * `facet install` — bring the project on disk into agreement with
 * `facets.json`. Honors any pinned versions already in `facets.lock`;
 * resolves missing entries fresh; bootstraps the lockfile when none
 * exists yet (bun-style).
 *
 * The actual pipeline lives in `runInstall` from `@agent-facets/engine`;
 * this file is just the display + routing wrapper.
 */
export const installCommand: Command = {
  name: 'install',
  description: 'Install all facets from facets.json',
  implemented: true,
  flags: {
    verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
    'frozen-lockfile': {
      type: 'boolean',
      description: 'Treat the lockfile as the source of truth; fail on any manifest/lockfile drift',
    },
  },
  run: async (args, flags) => {
    if (args.length > 0) {
      writeCliError({
        what: `facet install does not accept positional arguments (got "${args[0]}")`,
        fix: "use 'facet add <source>' to add a new facet",
      })
      return 1
    }

    const verbose = flags.verbose === true
    const frozenLockfile = flags['frozen-lockfile'] === true

    const projectRoot = process.cwd()

    // Discover or pick adapters.
    const adapters = await ensureAdapters()
    if (adapters === null) {
      // ensureAdapters already wrote the appropriate CLI error.
      return 1
    }

    // Wire SIGINT to an AbortController so core never installs a
    // process-global signal handler. The view's deferred-exit pattern
    // ensures the rollback render lands before unmount.
    const controller = new AbortController()
    const sigintHandler = () => {
      process.stderr.write('\nInterrupted. Rolling back...\n')
      controller.abort()
    }
    process.on('SIGINT', sigintHandler)

    let captured: RunInstallResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        run: async (onStage, onLog) => {
          const result = await runInstall({
            projectRoot,
            adapters,
            onStage,
            ...(verbose && onLog ? { onLog } : {}),
            signal: controller.signal,
            frozenLockfile,
          })
          captured = result
          return result
        },
        onComplete: (r) => {
          // `install` never produces a prepare-phase failure (add/remove
          // only); guard the wider InstallViewResult so the captured value
          // stays a RunInstallResult. The `run` closure already set
          // `captured`.
          if (!('prepareFailure' in r) && !('removePrepareFailure' in r)) captured = r
        },
      }),
    )

    try {
      await instance.waitUntilExit()
    } catch {
      // Ink rejects on view-level errors (the view sets pendingExit).
      // The result is already captured; we just need to fall through
      // to the post-render error handling below.
    } finally {
      process.off('SIGINT', sigintHandler)
    }

    if (!captured) {
      writeCliError({
        what: 'install failed',
        detail: 'the install pipeline returned no result',
        fix: 'this is a bug; please file an issue with the verbose log',
      })
      return 1
    }

    if (!captured.ok) {
      // The view rendered the structured failure block on stdout. Emit
      // the canonical CLI error block on stderr so scripts and existing
      // tests that grep stderr for 'install failed' continue to work.
      writeCliError({
        what: 'install failed',
        detail: failureDetail(captured.failure),
        fix: failureFix(captured.failure, captured.rollback),
      })
      return 1
    }

    return 0
  },
}

/**
 * Carry the structured failure code into the CLI error's detail line so
 * log-grepping can branch on the exact reason without parsing the
 * (richer) Ink-rendered failure block on stdout.
 */
function failureDetail(failure: RunInstallFailure): string {
  return `code=${failure.code}`
}

function failureFix(failure: RunInstallFailure, rollback: RollbackOutcome): string {
  if (rollback.kind === 'partial-failure') {
    return `partial state on disk after ${rollback.failures} rollback failure(s); re-run 'facet install' to attempt reconciliation`
  }
  if (failure.code === 'ABORTED') {
    return 'rollback complete; project state unchanged'
  }
  if (failure.code === 'LOCKFILE_DRIFT') {
    return "lockfile is out of date; run 'facet install' (without --frozen-lockfile) or 'facet add' to update it"
  }
  if (failure.code === 'ASSET_PATH_COLLISION') {
    return `two assets map to ${failure.path} on ${failure.adapter}; rename one so they no longer collide`
  }
  return "rollback complete; fix the underlying issue and re-run 'facet install'"
}
