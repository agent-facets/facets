import { detectInstallMethod } from './detect.ts'
import type { SelfUpdateErrorHandler } from './methods/types.ts'
import { installMethods } from './registry.ts'
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
  const method = await detectInstallMethod()
  const handler = installMethods[method]

  // Dev-mode short-circuit. The local-dev handler refuses regardless of
  // version or --dry-run — running version-check first would hit the
  // network needlessly, and the "already up to date" branch below would
  // hide the refusal message a developer expects to see.
  if (method === 'local-dev') {
    return handler.update({
      targetVersion: opts.targetVersion ?? '',
      dryRun: opts.dryRun,
      onOutput: opts.onOutput,
      onError: opts.onError,
    })
  }

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
