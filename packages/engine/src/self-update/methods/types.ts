/**
 * Public types for the self-update install-method registry.
 *
 * Each install path through which a user can receive the `facet` binary
 * (curl installer, JS package-manager global install, dev mode, or
 * unclassified) is represented as a single `MethodKind`. A matching
 * `InstallMethod` value owns the update mechanism for that kind: it
 * describes the command it would run (used by `--dry-run`) and runs it.
 */

import type { LatestVersionResult } from '../version-check.ts'

export type MethodKind = 'curl' | 'npm' | 'yarn' | 'pnpm' | 'bun' | 'local-dev' | 'unknown'

/**
 * Structured event payload for self-update error reporting.
 *
 * Engine emits these; the CLI exhaustively switches on `kind` to format
 * each one into user-facing prose (the canonical 3-line `error:` block,
 * a one-line stderr message, etc.). Adding a new variant forces the CLI
 * to handle it (compile-time obligation), which is the whole reason for
 * the discriminator instead of a free-form string channel.
 *
 *   - `message` — preformatted line for direct stderr write. Used by
 *     spawn failures, dev-mode refusals, curl-installer fetch errors,
 *     anywhere the engine already had a useful one-line message.
 *   - `latest-version-failure` — `getLatestVersion` returned a non-ok
 *     result. Carries the structured failure verbatim so the CLI can
 *     render it via `formatLatestVersionFailure`.
 */
export type SelfUpdateErrorEvent =
  | { kind: 'message'; line: string }
  | { kind: 'latest-version-failure'; failure: Extract<LatestVersionResult, { ok: false }> }

/**
 * Callback shape for self-update error reporting. Engine emits a
 * structured event; the CLI's handler renders it for the user. Tests
 * pass a collector to assert on the event sequence.
 */
export type SelfUpdateErrorHandler = (event: SelfUpdateErrorEvent) => void

/**
 * Inputs handed to a method's `describe()` and `update()`. The orchestrator
 * fills these in once per invocation; methods do not consult globals.
 */
export interface UpdateOptions {
  /**
   * The version the update should target — typically the latest version
   * from the npm registry, or a value pinned by `--version <x.y.z>`.
   * Always set by the time a method receives it (the orchestrator resolves
   * "latest" before dispatch).
   */
  targetVersion: string
  /**
   * When true, the method MUST NOT touch the filesystem or spawn any
   * non-read-only subprocess. `describe()` is the only output path.
   */
  dryRun: boolean
  /**
   * Optional callback for normal output lines (informational messages,
   * post-install warnings, status). The CLI passes a callback that writes
   * to stdout; tests can pass a no-op or a collector. When omitted, output
   * is silently swallowed.
   */
  onOutput?: (line: string) => void
  /**
   * Optional callback for structured error events (failed fetches,
   * spawn failures, dev-mode refusals). Engine emits a discriminated
   * `SelfUpdateErrorEvent`; the CLI exhaustively renders each kind.
   */
  onError?: SelfUpdateErrorHandler
}

/**
 * One install method. Each entry in the registry implements this contract.
 *
 * Adding a new install method (e.g., Homebrew, Chocolatey, scoop) is a
 * matter of producing a new `InstallMethod` value and registering it under
 * a new `MethodKind` — no changes to existing methods are required.
 */
export interface InstallMethod {
  readonly kind: MethodKind
  /** Human-readable label used in `--dry-run` output (e.g., "npm (global)"). */
  readonly displayName: string
  /**
   * Returns the exact shell command this method WOULD run for the given
   * options. Pure: never spawns a subprocess, never writes to disk.
   * Used by the `--dry-run` path to show the user what would happen.
   */
  describe(opts: UpdateOptions): string
  /**
   * Performs the update. Returns the exit code to surface to the user.
   * `stdio: 'inherit'` is expected so that progress output from the
   * dispatched tool reaches the user in real time.
   */
  update(opts: UpdateOptions): Promise<number>
}
