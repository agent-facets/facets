import { realpathSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { dirname, join, resolve as pathResolve } from 'node:path'
import type { MethodKind } from './methods/types.ts'

/**
 * How long each package-manager probe is allowed to run before we treat it
 * as "no answer" and move on. Bun.spawn's native `timeout` option kills the
 * subprocess with SIGTERM after this elapses.
 *
 * The four probes run in parallel, so this is also (roughly) the worst-case
 * detection latency — not 4× this value.
 */
const PROBE_TIMEOUT_MS = 3000

/**
 * Dependencies for `detectInstallMethod`. All have sensible defaults pulled
 * from the running process; tests override them to keep the algorithm
 * deterministic and subprocess-free.
 */
export interface DetectDependencies {
  /** Path of the running binary. Defaults to `process.execPath`. */
  execPath: string
  /** Process environment. Reads `FACET_BIN_OVERRIDE` and `FACET_DIR`. */
  env: NodeJS.ProcessEnv
  /** User home directory. Defaults to `os.homedir()`. */
  homedir: string
  /**
   * Resolves symlinks. Defaults to `fs.realpathSync`. Tests pass an identity
   * function or a fake to avoid touching the real filesystem.
   */
  realpath: (p: string) => string
  /**
   * Run a probe command and return its combined stdout+stderr text on a
   * zero-exit-code success. Returns `null` on any failure (timeout,
   * missing binary, non-zero exit). Tests inject a fake spawn keyed on the
   * command argv.
   */
  spawn: (cmd: string[], opts: { timeoutMs: number }) => Promise<string | null>
}

/** Probe definition: which package manager to ask, and how. */
interface Probe {
  kind: Extract<MethodKind, 'npm' | 'yarn' | 'pnpm' | 'bun'>
  cmd: string[]
}

const PROBES: readonly Probe[] = [
  { kind: 'npm', cmd: ['npm', 'list', '-g', '--depth=0'] },
  { kind: 'pnpm', cmd: ['pnpm', 'list', '-g', '--depth=0'] },
  { kind: 'bun', cmd: ['bun', 'pm', 'ls', '-g'] },
  { kind: 'yarn', cmd: ['yarn', 'global', 'list'] },
] as const

/**
 * Spawn a probe command using Bun.spawn's native timeout. Returns combined
 * output on zero-exit success, or `null` on any failure.
 *
 * `Bun.spawn` throws synchronously when the binary is not on `$PATH`
 * (ENOENT), so the try/catch covers both "tool not installed" and runtime
 * errors. The native `timeout` option kills the process with SIGTERM
 * after the deadline; the resulting non-zero exit code falls into the
 * "return null" branch below.
 */
async function defaultSpawn(cmd: string[], opts: { timeoutMs: number }): Promise<string | null> {
  try {
    const [first, ...args] = cmd
    if (!first) return null
    const proc = Bun.spawn([first, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: opts.timeoutMs,
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) return null
    return stdout + stderr
  } catch {
    return null
  }
}

/**
 * Path-hint reorder. Look for distinctive package-manager segments in the
 * resolved binary path so the probe most likely to win runs first. The hint
 * is a tiebreaker only — all four probes run in parallel either way.
 *
 * We require slash-bracketed segments (`/pnpm/`) rather than bare substring
 * matches to avoid false positives like a username `bunny` matching `bun`.
 * Forward slashes only — Bun's compiled binaries never run on Windows for
 * this CLI today, so no need for `\\pnpm\\` variants.
 */
function hintedKind(execPathLower: string): MethodKind | null {
  // Match `bun` as a directory segment, including the dotfile variant
  // (`~/.bun/install/global/...` is Bun's default global install layout).
  // The leading char must be `/` or `.` so we don't false-match usernames
  // or unrelated path components like `bunny` or `bundle`.
  if (/(?:^|\/)\.?bun\/(?:install|global)\//.test(execPathLower)) return 'bun'
  // Same idea for pnpm and yarn — `.pnpm`/`.yarn` are common dotfile dirs.
  if (/(?:^|\/)\.?pnpm\//.test(execPathLower)) return 'pnpm'
  if (/(?:^|\/)\.?yarn\//.test(execPathLower)) return 'yarn'
  // npm's path layout is too varied to give a reliable hint
  // (Linux: /usr/lib, brew: /opt/homebrew/lib, nvm: ~/.nvm/...).
  // Leave npm as the no-hint default so it isn't promoted by accident.
  return null
}

/**
 * Order PROBES so the hinted probe (if any) runs/checks first. Used both
 * for spawn ordering (no real cost — they're parallel) and result-checking
 * priority (when multiple managers report `agent-facets`, the hinted one
 * wins).
 */
function orderedProbes(execPath: string): readonly Probe[] {
  const hint = hintedKind(execPath.toLowerCase())
  if (hint === null) return PROBES
  const hinted = PROBES.find((p) => p.kind === hint)
  if (!hinted) return PROBES
  const rest = PROBES.filter((p) => p.kind !== hint)
  return [hinted, ...rest]
}

/**
 * Decide how the running binary was installed.
 *
 * Algorithm:
 *
 *   1. `FACET_BIN_OVERRIDE` set → `local-dev` (dev mode short-circuit).
 *   2. Resolved binary lives under the curl install dir → `curl`.
 *   3. Run all four package-manager probes in parallel; the one whose
 *      output mentions `agent-facets` wins. Path hints reorder ties.
 *   4. Otherwise → `unknown`.
 *
 * No filesystem writes, no network, no subprocesses for steps 1–2. Only
 * step 3 spawns probes, and each one has a 3-second timeout.
 */
export async function detectInstallMethod(deps?: Partial<DetectDependencies>): Promise<MethodKind> {
  const d: DetectDependencies = {
    execPath: deps?.execPath ?? process.execPath,
    env: deps?.env ?? process.env,
    homedir: deps?.homedir ?? osHomedir(),
    realpath: deps?.realpath ?? realpathSync,
    spawn: deps?.spawn ?? defaultSpawn,
  }

  // ── 1. Dev mode short-circuit ────────────────────────────────────────
  // `FACET_BIN_OVERRIDE` overrides the binary the launcher executes.
  // When set, the user has taken control of which binary runs, so
  // self-update must refuse — we don't know what's at the override path
  // and have no business writing over it.
  if (d.env.FACET_BIN_OVERRIDE !== undefined && d.env.FACET_BIN_OVERRIDE !== '') {
    return 'local-dev'
  }

  // Resolve symlinks once. The compiled binary may live at a versioned path
  // and the user may have a `~/.local/bin/facet` symlink to it; we want the
  // real path for both the curl-dir match and path hints.
  let resolvedExec: string
  try {
    resolvedExec = d.realpath(d.execPath)
  } catch {
    // realpath failure is unusual but shouldn't crash detection. Fall back
    // to the unresolved path; matching may miss but `unknown` is a safe
    // fallback at the end.
    resolvedExec = d.execPath
  }

  // ── 2. Curl-path match ──────────────────────────────────────────────
  // The curl installer puts the binary at `$FACET_DIR/bin/facet`.
  // Default `$FACET_DIR` is `$HOME/.facet`. Whitespace-only env values
  // fall back to the default — matches `resolveFacetDir()` semantics in
  // `facet-dir.ts` for the rest of the system.
  const trimmedFacetDir = d.env.FACET_DIR?.trim()
  const installRoot = trimmedFacetDir && trimmedFacetDir.length > 0 ? trimmedFacetDir : join(d.homedir, '.facet')
  const curlBinDir = pathResolve(installRoot, 'bin')
  if (dirname(resolvedExec) === curlBinDir) {
    return 'curl'
  }

  // ── 3. Parallel package-manager probes ──────────────────────────────
  const probes = orderedProbes(resolvedExec)
  const results = await Promise.all(
    probes.map(async (probe) => {
      const output = await d.spawn(probe.cmd, { timeoutMs: PROBE_TIMEOUT_MS })
      if (output === null) return null
      // Regex pattern match for the package name and a safe identifier.
      // The actual output formats vary by tool (boxes, indentation,
      // prefixes), but the package name is `agent-facets` for all of them.
      return /agent-facets[@ ]/.test(output.toLowerCase()) ? probe.kind : null
    }),
  )

  // First positive result in hint-ordered sequence wins.
  for (const r of results) {
    if (r !== null) return r
  }

  // ── 4. Unclassified ─────────────────────────────────────────────────
  return 'unknown'
}
