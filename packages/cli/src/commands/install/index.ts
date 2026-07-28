import { type RunInstallFailure, type RunInstallResult, runInstall } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { writeMaterializationDetail } from '../../util/collision-report.ts'
import { writeCliError } from '../../util/errors.ts'
import { canPromptInteractively } from '../../util/interactive.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'
import { installFailureFix } from '../shared/install-failure.ts'

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
    //
    // The copy is deliberately vague about rollback: an interrupt during
    // resolution has nothing to undo, and promising a rollback that never
    // happened sends people looking for damage that isn't there. The
    // structured result says what actually occurred.
    const controller = new AbortController()
    const sigintHandler = () => {
      process.stderr.write('\nInterrupted. Stopping safely...\n')
      controller.abort()
    }
    process.on('SIGINT', sigintHandler)

    // Frozen mode reproduces recorded intent, so it must never collect a
    // new decision — not even from a human sitting at a terminal.
    const mayPrompt = !frozenLockfile && canPromptInteractively()

    let captured: RunInstallResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'install',
        signal: controller.signal,
        run: async (onStage, onLog, resolveCollisions) => {
          const result = await runInstall({
            projectRoot,
            adapters,
            onStage,
            ...(verbose && onLog ? { onLog } : {}),
            ...(mayPrompt ? { resolveCollisions } : {}),
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
      // Ctrl-C must reach the collision workspace, which is the only
      // thing that can settle the engine's pending resolver call and let
      // it release the project lock. Ink's built-in handler would exit
      // the render without ever settling that promise.
      { exitOnCtrlC: false },
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
      //
      // A collision needs more than three lines to act on, and the
      // contexts that produce one without a prompt are exactly the ones
      // where stdout is discarded — so the full report goes to stderr
      // first, leaving `fix:` as the last line.
      writeMaterializationDetail(captured.failure)
      writeCliError({
        what: 'install failed',
        detail: failureDetail(captured.failure),
        fix: installFailureFix(captured.failure, captured.rollback, 'install'),
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
