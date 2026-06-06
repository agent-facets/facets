import {
  type AddPrepareFailure,
  type AddSource,
  type ParseError,
  parseFacetSource,
  type RunAddResult,
  runAdd,
} from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'

/**
 * `facet add <source> [more sources...]` — adds one or more facets to
 * `facets.json` and immediately installs them.
 *
 * This command is a thin caller over the engine `add` orchestrator
 * (`runAdd`), which owns the entire manifest transaction: resolve each
 * source's facet name, snapshot `facets.json`, write provisional entries
 * (applying the per-source manifest-value rule), run the install
 * pipeline, rewrite pinned entries with the resolved version on success,
 * and restore the snapshot on failure. This file only parses argv,
 * ensures adapters, renders progress, and maps the result to an exit
 * code + error block.
 */
export const addCommand: Command = {
  name: 'add',
  description: 'Add a facet to facets.json and install it',
  usage: '<source> [more sources...]',
  implemented: true,
  flags: {
    verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
  },
  run: async (args, flags) => {
    if (args.length === 0) {
      writeCliError({
        what: 'missing source specifier',
        detail: 'facet add requires at least one source',
        fix: 'run: facet add <source>    (e.g. facet add github:agent-facets/viper-plans#main)',
      })
      return 1
    }

    const verbose = flags.verbose === true
    const onLog = verbose ? (line: string) => process.stderr.write(`${line}\n`) : undefined

    // Parse every source up front. No I/O happens here; any parse error
    // aborts before mounting the view or touching disk.
    const sources: AddSource[] = []
    for (const specifier of args) {
      const result = parseFacetSource(specifier)
      if (!result.ok) {
        writeParseError(specifier, result.error)
        return 1
      }
      sources.push({ specifier, source: result.value })
    }

    const projectRoot = process.cwd()

    // Discover or pick adapters.
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

    let captured: RunAddResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: async (onStage) => {
          const result = await runAdd({
            projectRoot,
            sources,
            adapters,
            onStage,
            ...(onLog ? { onLog } : {}),
            signal: controller.signal,
          })
          captured = result
          // The view renders from a RunInstallResult-shaped value. Map
          // runAdd's result into what the view expects: install success
          // and install failures pass through verbatim; a prepare-phase
          // failure surfaces via the dedicated prepare-failure arm.
          if (result.ok) return result.install
          if (result.phase === 'install') return result.install
          return { ok: false, prepareFailure: result.failure }
        },
        onComplete: (r) => {
          // `onComplete` receives the view-shaped result; `captured` is
          // already the richer RunAddResult set in `run`.
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
        what: 'add failed',
        detail: 'the add pipeline returned no result',
        fix: 'this is a bug; please file an issue with the verbose log',
      })
      return 1
    }

    if (captured.ok) return 0

    if (captured.phase === 'prepare') {
      writePrepareError(captured.failure)
      return 1
    }

    // Install-phase failure. The orchestrator restored the manifest
    // snapshot; branch the guidance on whether restore succeeded and
    // whether the install rollback was partial.
    const rollback = captured.install.rollback
    const partialFailureCount = rollback.kind === 'partial-failure' ? rollback.failures : 0
    const rollbackFailed = partialFailureCount > 0 || !captured.manifestRestored
    writeCliError({
      what: 'add failed',
      detail: `code=${captured.install.failure.code}`,
      fix: rollbackFailed
        ? `partial rollback: some state may remain (manifest restored: ${captured.manifestRestored}). Inspect and clean manually before re-running 'facet add'.`
        : "rollback complete; project state unchanged. Fix the underlying issue and re-run 'facet add'.",
    })
    return 1
  },
}

function writeParseError(specifier: string, error: ParseError): void {
  writeCliError({
    what: `could not parse source "${specifier}"`,
    detail: error.what,
    fix: error.fix,
  })
}

/**
 * Map an `AddPrepareFailure` (engine) to the canonical CLI error block on
 * stderr. The view already rendered a richer block on stdout; this keeps
 * stderr grep-friendly and gives each failure a precise fix line.
 */
function writePrepareError(failure: AddPrepareFailure): void {
  switch (failure.reason) {
    case 'manifest-read':
      writeCliError({
        what: 'could not read facets.json',
        detail: failure.error,
        fix: 'fix or delete the malformed facets.json and retry',
      })
      return
    case 'git-binary-missing':
      writeCliError({
        what: `could not clone git source "${failure.specifier}"`,
        detail: 'git is not installed (or not on PATH)',
        fix: 'install git and re-run this command',
      })
      return
    case 'git-auth-required':
      writeCliError({
        what: `git authentication required for ${failure.url}`,
        detail: 'closed alpha supports public repos and SSH (via agent) only',
        fix: 'use a public URL or configure your SSH agent',
      })
      return
    case 'git-clone-failed':
      writeCliError({
        what: `could not clone git source "${failure.specifier}"`,
        detail: failure.stderr,
        fix: 'verify the URL and your network connectivity',
      })
      return
    case 'git-checkout-failed':
      writeCliError({
        what: `could not check out commit ${failure.commitish} in "${failure.specifier}"`,
        detail: failure.stderr,
        fix: 'verify the commit SHA exists in the repository',
      })
      return
    case 'git-commit-unresolved':
      writeCliError({
        what: `could not pin a commit for git source "${failure.specifier}"`,
        detail: failure.stderr || `cloned ${failure.url} but git rev-parse HEAD did not return a commit`,
        fix: 'a git source must resolve to a commit to be reproducible; verify the repository has a valid HEAD',
      })
      return
    case 'local-resolve-failed':
      writeCliError({
        what: `could not resolve local source "${failure.specifier}"`,
        detail: failure.error,
        fix: 'check the path exists inside the project tree',
      })
      return
    case 'manifest-load-failed':
      writeCliError({
        what: `could not load facet.json from ${failure.specifier}`,
        detail: failure.detail,
        fix: 'verify the source is a facet directory with a valid facet.json',
      })
      return
    case 'composition-rejected':
      writeCliError({
        what: 'facet composition is not supported',
        detail: `${failure.specifier} declares dependencies on other facets`,
        fix: 'use a non-composing facet, or wait until composition support ships',
      })
      return
  }
}
