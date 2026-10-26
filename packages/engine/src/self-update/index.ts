import { detectInstallMethod } from './detect.ts'
import { resolveHomebrewInstall } from './homebrew.ts'
import { createMiseMethod } from './methods/mise.ts'
import type { SelfUpdateErrorHandler } from './methods/types.ts'
import { resolveMiseInstall } from './mise.ts'
import { homebrewMethod, installMethods } from './registry.ts'
import { getLatestVersion } from './version-check.ts'

export interface RunSelfUpdateOptions {
  /**
   * The current version of the running CLI binary. Caller passes this
   * in (rather than core importing a version constant) so core stays
   * decoupled from the CLI's build-time `version.ts`.
   */
  currentVersion: string
  /** Pin the update to this version. Omitted = use latest from the registry. */
  targetVersion?: string
  /** Print the plan; do not modify any files. */
  dryRun: boolean
  /**
   * Optional callback for normal output (dry-run report, "already up to
   * date" message, post-install warnings). The CLI passes a callback that
   * writes to stdout; tests pass a collector or no-op.
   */
  onOutput?: (line: string) => void
  /**
   * Optional callback for structured error events (failed fetches,
   * dev-mode refusal, spawn failures, latest-version lookup failures).
   * Engine emits a `SelfUpdateErrorEvent`; the CLI's handler renders
   * each `kind` for the user.
   */
  onError?: SelfUpdateErrorHandler
}

/**
 * Orchestrate one `facet self-update` invocation.
 *
 * Detects how the running binary was installed, resolves the target version
 * (a pinned `--version` value or the latest from the npm registry), and
 * dispatches to the matching install-method handler. `--dry-run` short-circuits
 * before any side effects.
 *
 * Returns the exit code the CLI should surface to the user.
 */
export async function runSelfUpdate(opts: RunSelfUpdateOptions): Promise<number> {
  const detected = await detectInstallMethod()

  // Dev-mode short-circuit. The local-dev handler refuses regardless of
  // version or --dry-run — running version-check first would hit the
  // network needlessly, and the "already up to date" branch below would
  // hide the refusal message a developer expects to see.
  if (detected === 'local-dev') {
    return installMethods['local-dev'].update({
      targetVersion: opts.targetVersion ?? '',
      dryRun: opts.dryRun,
      onOutput: opts.onOutput,
      onError: opts.onError,
    })
  }

  // Homebrew owns both version selection and binary replacement. Resolve its
  // ownership before the npm lookup or unknown-method fallback, so an offline
  // Homebrew user never gets prompted to run a competing installer.
  const homebrew = await resolveHomebrewInstall()
  if (homebrew.kind === 'guidance') {
    opts.onError?.({ kind: 'homebrew-guidance', reason: homebrew.reason })
    return 0
  }
  if (homebrew.kind === 'verified') {
    if (opts.targetVersion !== undefined) {
      opts.onError?.({
        kind: 'message',
        line: 'Homebrew cannot install an arbitrary Facet version with `facet self-update --version`.\n',
      })
      return 1
    }
    return homebrewMethod.update({
      targetVersion: '',
      dryRun: opts.dryRun,
      onOutput: opts.onOutput,
      onError: opts.onError,
    })
  }

  const mise = await resolveMiseInstall()
  // `homebrew` returned above. Retain the unknown fallback here so the
  // registry remains total if a detector adds a method before its updater.
  const fallbackMethod =
    detected === 'mise' || detected === 'homebrew' ? installMethods.unknown : installMethods[detected]
  const method = mise.kind === 'updatable' ? createMiseMethod(mise.install) : fallbackMethod
  const miseGuidance = mise.kind === 'guidance' ? mise : null
  const handler = method

  // Resolve the version we'd update TO. A pinned version skips the network
  // probe — we already know what to install. Otherwise, ask the registry.
  // `getLatestVersion` returns a discriminated `LatestVersionResult`; on
  // failure we surface the structured event and bail with exit code 1.
  let target: string
  if (opts.targetVersion !== undefined) {
    target = opts.targetVersion
  } else {
    const result = await getLatestVersion()
    if (!result.ok) {
      opts.onError?.({ kind: 'latest-version-failure', failure: result })
      return 1
    }
    target = result.version
  }

  if (miseGuidance !== null && opts.currentVersion !== target) {
    opts.onError?.({
      kind: 'mise-guidance',
      reason: miseGuidance.reason,
    })
    return 0
  }

  // Dry-run path: render the plan and exit. No filesystem side effects, no
  // subprocess, no exceptions for "already up to date" — just status.
  if (opts.dryRun) {
    const upToDate = opts.currentVersion === target
    opts.onOutput?.(
      `Current: ${opts.currentVersion}\n` +
        `Latest:  ${target}\n` +
        `Update available: ${upToDate ? 'no' : 'yes'}\n` +
        `\n` +
        `Detected install method: ${handler.displayName}\n` +
        (upToDate
          ? `(no command to run — already up to date)\n`
          : `Would run: ${handler.describe({ targetVersion: target, dryRun: true })}\n`),
    )
    return 0
  }

  // No-op path: target equals current. Don't spawn anything.
  if (opts.currentVersion === target) {
    opts.onOutput?.(`facet is already up to date (${opts.currentVersion}).\n`)
    return 0
  }

  // Real update: dispatch to the method handler. Its exit code becomes ours.
  return handler.update({
    targetVersion: target,
    dryRun: false,
    onOutput: opts.onOutput,
    onError: opts.onError,
  })
}
