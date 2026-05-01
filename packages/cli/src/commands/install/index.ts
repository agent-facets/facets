import { loadInstalledAdapters, type RunInstallFailure, type RunInstallResult, runInstall } from '@agent-facets/core'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { writeCliError } from '../../util/errors.ts'

/**
 * `facet install` — bring the project on disk into agreement with
 * `facets.json`. Honors any pinned versions already in `facets.lock`;
 * resolves missing entries fresh; bootstraps the lockfile when none
 * exists yet (bun-style).
 *
 * The actual pipeline lives in `runInstall` from `@agent-facets/core`;
 * this file is just the display + routing wrapper.
 */
export const installCommand: Command = {
  name: 'install',
  description: 'Install all facets from facets.json',
  implemented: true,
  flags: {
    verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
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
    const onLog = verbose ? (line: string) => process.stderr.write(`${line}\n`) : undefined

    const projectRoot = process.cwd()

    // Discover installed adapters. Failures here are surfaced as
    // CLI errors directly — runInstall doesn't know how to render the
    // "no adapters installed" hint that points users at the picker.
    const adapters = await loadInstalledAdapters()
    const installable = adapters.filter((a) => a.supportsInstall === true)
    if (adapters.length > 0 && installable.length === 0) {
      const stale = adapters.map((a) => a.name).join(', ')
      writeCliError({
        what: `installed adapters do not support install yet: ${stale}`,
        detail: 'these adapters were bundled before install support shipped; the capability flag is missing',
        fix: "update each with 'facet adapter install <name>' to pull a version with install support",
      })
      return 1
    }
    if (installable.length === 0) {
      const detail = process.stdout.isTTY
        ? 'facet install requires at least one installed adapter to materialize assets'
        : 'this is a non-interactive environment; the picker cannot run here'
      const fix = process.stdout.isTTY
        ? "run 'facet adapter install' and pick which AI tools to connect"
        : "run 'facet adapter install <name>' with an explicit adapter (e.g. claude-code, opencode)"
      writeCliError({ what: 'no adapters installed', detail, fix })
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
        run: async (onStage) => {
          const result = await runInstall({
            projectRoot,
            adapters: installable,
            onStage,
            onLog,
            signal: controller.signal,
          })
          captured = result
          return result
        },
        onComplete: (r) => {
          captured = r
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

function failureFix(
  failure: RunInstallFailure,
  rollback: { ok: true } | { ok: false; partialFailures: number },
): string {
  if (!rollback.ok) {
    return `partial state on disk after ${rollback.partialFailures} rollback failure(s); re-run 'facet install' to attempt reconciliation`
  }
  if (failure.code === 'ABORTED') {
    return 'rollback complete; project state unchanged'
  }
  return "rollback complete; fix the underlying issue and re-run 'facet install'"
}
