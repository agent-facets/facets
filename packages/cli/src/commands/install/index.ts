import { type InstallOperation, type RunInstallResult, runInstall } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { writeInstallFailureDetail } from '../../util/install-detail.ts'
import { canPromptInteractively } from '../../util/interactive.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'
import { ACCEPT_MCP_FLAG, INSTALL_PIPELINE_FLAGS, mcpConsentPolicy } from '../shared/flags.ts'
import { installFailureDetail, installFailureFix } from '../shared/install-failure.ts'

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
    ...INSTALL_PIPELINE_FLAGS,
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
    const acceptMcp = flags[ACCEPT_MCP_FLAG] === true

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
        run: async ({ onStage, onLog, resolveCollisions, resolveMcpConsent, resolveAssetTakeover }) => {
          // `mayPrompt` already excludes frozen mode, so a frozen run can
          // reach `preapproved` via the flag but never the prompting arm —
          // which is also the only arm the frozen operation accepts.
          const consent = mcpConsentPolicy({ acceptMcp, mayPrompt, resolve: resolveMcpConsent })
          const operation: InstallOperation = frozenLockfile
            ? {
                kind: 'reproduce',
                frozen: true,
                ...(consent.kind === 'interactive' ? {} : { mcpConsent: consent }),
              }
            : {
                kind: 'reproduce',
                frozen: false,
                mcpConsent: consent,
                ...(mayPrompt ? { resolveCollisions, resolveAssetTakeover } : {}),
              }
          const result = await runInstall({
            projectRoot,
            adapters,
            operation,
            onStage,
            ...(verbose ? { onLog } : {}),
            signal: controller.signal,
          })
          captured = result
          return result
        },
        onComplete: (r) => {
          // `install` produces none of the flow-specific failure arms —
          // prepare belongs to add/remove, selection to update — so this
          // narrows the wider InstallViewResult back to the only shape
          // this command can receive. The `run` closure already set
          // `captured`.
          if ('prepareFailure' in r || 'removePrepareFailure' in r || 'updateSelectionFailure' in r) return
          captured = r
        },
      }),
      // Ctrl-C must reach the collision workspace, which is the only
      // thing that can settle the engine's pending resolver call and let
      // it release the project lock. Ink's built-in handler would exit
      // the render without ever settling that promise.
      { exitOnCtrlC: false },
    )

    // Not wrapped in `catch`: a structured install failure unmounts the
    // view cleanly and is read from `captured` below. A rejection here
    // means the view or the driver failed in a way nothing modelled, and
    // that belongs at the CLI's top level as an unexpected failure
    // rather than being reshaped into an install error it is not.
    try {
      await instance.waitUntilExit()
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
      writeInstallFailureDetail(captured.failure, captured.rollback)
      writeCliError({
        what: 'install failed',
        detail: installFailureDetail(captured.failure),
        fix: installFailureFix(captured.failure, captured.rollback, 'install'),
      })
      return 1
    }

    return 0
  },
}
