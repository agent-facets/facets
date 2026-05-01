import { version as currentVersion } from '../version.ts'
import { detectInstallMethod } from './detect.ts'
import { installMethods } from './registry.ts'
import { getLatestVersion } from './version-check.ts'

export interface RunSelfUpdateOptions {
  /** Pin the update to this version. Omitted = use latest from the registry. */
  targetVersion?: string
  /** Print the plan; do not modify any files. */
  dryRun: boolean
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
    return handler.update({ targetVersion: opts.targetVersion ?? currentVersion, dryRun: opts.dryRun })
  }

  // Resolve the version we'd update TO. A pinned version skips the network
  // probe — we already know what to install.
  const target = opts.targetVersion ?? (await getLatestVersion())

  // Dry-run path: render the plan and exit. No filesystem side effects, no
  // subprocess, no exceptions for "already up to date" — just status.
  if (opts.dryRun) {
    const upToDate = currentVersion === target
    const targetLabel = opts.targetVersion ? 'Target' : 'Latest'
    process.stdout.write(
      `Current: ${currentVersion}\n` +
        `${targetLabel}:  ${target}\n` +
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
  if (currentVersion === target) {
    process.stdout.write(`facet is already up to date (${currentVersion}).\n`)
    return 0
  }

  // Real update: dispatch to the method handler. Its exit code becomes ours.
  return handler.update({ targetVersion: target, dryRun: false })
}
