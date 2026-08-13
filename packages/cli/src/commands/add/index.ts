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
import { type CliError, writeCliError } from '../../util/errors.ts'
import { writeInstallFailureDetail } from '../../util/install-detail.ts'
import { canPromptInteractively } from '../../util/interactive.ts'
import { unsupportedManifestVersionError } from '../../util/unsupported-manifest-version.ts'
import { ensureAdapters } from '../shared/ensure-adapters.ts'
import { ACCEPT_MCP_FLAG, INSTALL_PIPELINE_FLAGS, mcpConsentPolicy } from '../shared/flags.ts'
import { installFailureDetail, installFailureFix } from '../shared/install-failure.ts'

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
  flags: INSTALL_PIPELINE_FLAGS,
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
    const acceptMcp = flags[ACCEPT_MCP_FLAG] === true

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
      process.stderr.write('\nInterrupted. Stopping safely...\n')
      controller.abort()
    }
    process.on('SIGINT', sigintHandler)

    const mayPrompt = canPromptInteractively()

    let captured: RunAddResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        signal: controller.signal,
        run: async ({ onStage, onLog, resolveCollisions, resolveMcpConsent, resolveAssetTakeover }) => {
          const result = await runAdd({
            projectRoot,
            sources,
            adapters,
            onStage,
            mcpConsent: mcpConsentPolicy({ acceptMcp, mayPrompt, resolve: resolveMcpConsent }),
            ...(verbose ? { onLog } : {}),
            // Withheld when this run cannot prompt, because absence is how
            // "continue automatically" is expressed — the same behavior a
            // non-interactive run had before the gate existed. Notably NOT
            // gated on `--accept-mcp`: approving a command is not approving
            // an overwrite.
            ...(mayPrompt ? { resolveCollisions, resolveAssetTakeover } : {}),
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

    // Install-phase failure. The delta-based flow never writes the manifest
    // ahead of install, so there's nothing to restore — the journal rollback
    // handles asset cleanup.
    writeInstallFailureDetail(captured.install.failure, captured.install.rollback)
    writeCliError({
      what: 'add failed',
      detail: installFailureDetail(captured.install.failure),
      fix: installFailureFix(captured.install.failure, captured.install.rollback, 'add'),
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
 *
 * Returns the error rather than writing it, so the `switch` has to produce a
 * value: a `void` switch with no `default` compiles happily when a new
 * variant is added and then silently prints nothing. The compiler now refuses
 * an unhandled variant instead.
 */
export function addPrepareCliError(failure: AddPrepareFailure): CliError {
  switch (failure.reason) {
    case 'manifest-read':
      return {
        what: 'could not read facets.json',
        detail: failure.error,
        fix: 'fix or delete the malformed facets.json and retry',
      }
    case 'manifest-unsupported-version':
      return unsupportedManifestVersionError(failure)
    case 'git-binary-missing':
      return {
        what: `could not clone git source "${failure.specifier}"`,
        detail: 'git is not installed (or not on PATH)',
        fix: 'install git and re-run this command',
      }
    case 'git-auth-required':
      return {
        what: `git authentication required for ${failure.url}`,
        detail: 'closed alpha supports public repos and SSH (via agent) only',
        fix: 'use a public URL or configure your SSH agent',
      }
    case 'git-clone-failed':
      return {
        what: `could not clone git source "${failure.specifier}"`,
        detail: failure.stderr,
        fix: 'verify the URL and your network connectivity',
      }
    case 'git-checkout-failed':
      return {
        what: `could not check out commit ${failure.commitish} in "${failure.specifier}"`,
        detail: failure.stderr,
        fix: 'verify the commit SHA exists in the repository',
      }
    case 'git-commit-unresolved':
      return {
        what: `could not pin a commit for git source "${failure.specifier}"`,
        detail: failure.stderr || `cloned ${failure.url} but git rev-parse HEAD did not return a commit`,
        fix: 'a git source must resolve to a commit to be reproducible; verify the repository has a valid HEAD',
      }
    case 'local-resolve-failed':
      return {
        what: `could not resolve local source "${failure.specifier}"`,
        detail: failure.error,
        fix: 'check the path exists inside the project tree',
      }
    case 'manifest-load-failed':
      return {
        what: `could not load facet.json from ${failure.specifier}`,
        detail: failure.detail,
        fix: 'verify the source is a facet directory with a valid facet.json',
      }
    case 'composition-rejected':
      return {
        what: 'facet composition is not supported',
        detail: `${failure.specifier} declares dependencies on other facets`,
        fix: 'use a non-composing facet, or wait until composition support ships',
      }
  }
}

function writePrepareError(failure: AddPrepareFailure): void {
  writeCliError(addPrepareCliError(failure))
}
