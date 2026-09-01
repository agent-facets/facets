/**
 * One decision, in one place: may this process open an interactive,
 * raw-mode terminal UI?
 *
 * Before this existed, four call sites each tested `process.stdout.isTTY`
 * alone. That test is not sufficient for anything that reads keys. Ink
 * calls `stdin.setRawMode()` the moment any mounted component uses
 * `useInput`, and `setRawMode` throws outright when stdin is not a TTY.
 * A command that checks only stdout therefore passes its own gate and
 * then crashes inside the renderer — `facet add > log.txt` in a terminal
 * is exactly that shape.
 *
 * The capability set is a plain record so the rule is a pure function of
 * data. Tests state the four facts directly instead of monkey-patching
 * global streams and hoping the patch is torn down.
 */

/** The four facts that decide interactivity. */
export interface TerminalCapabilities {
  /** Reading keystrokes at all requires stdin to be a terminal. */
  stdinIsTTY: boolean
  /** Drawing and repainting a live region requires stdout to be a terminal. */
  stdoutIsTTY: boolean
  /**
   * Whether stdin actually exposes `setRawMode`. A piped or synthetic
   * stdin can be missing it entirely, and Ink does not degrade — it
   * throws.
   */
  rawModeSupported: boolean
  /**
   * CI runners commonly allocate a pseudo-TTY with no human attached.
   * Prompting there does not fail fast; it hangs until the job times
   * out, which is the worst available outcome. Treated as
   * non-interactive so automation gets the structured failure instead.
   */
  ci: boolean
}

/**
 * The interactivity rule. Every condition is necessary: dropping any one
 * of them reintroduces either a crash inside Ink or a hung pipeline.
 */
export function isInteractive(capabilities: TerminalCapabilities): boolean {
  const { stdinIsTTY, stdoutIsTTY, rawModeSupported, ci } = capabilities
  return stdinIsTTY && stdoutIsTTY && rawModeSupported && !ci
}

/**
 * CI detection, deliberately identical to the `is-in-ci` check Ink itself
 * uses to decide whether a terminal is interactive. Agreeing with Ink
 * matters more than being clever here: if the two disagreed, we would
 * mount a workspace Ink has already decided not to drive.
 */
function detectCi(env: Record<string, string | undefined>): boolean {
  const set = (key: string): boolean => key in env && env[key] !== '0' && env[key] !== 'false'
  return set('CI') || set('CONTINUOUS_INTEGRATION')
}

/** Read the current process's capabilities. The only impure part. */
export function currentTerminalCapabilities(): TerminalCapabilities {
  return {
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    rawModeSupported: typeof process.stdin.setRawMode === 'function',
    ci: detectCi(process.env),
  }
}

/**
 * Whether a live, repainting region should be drawn at all.
 *
 * Deliberately weaker than `isInteractive`: an animated indicator reads
 * no keys, so stdin's shape is irrelevant to it. What matters is the two
 * facts Ink itself uses to decide whether it will repaint — a terminal
 * stdout, and not CI.
 *
 * Testing `stdout.isTTY` alone is the trap. A CI runner that allocates a
 * pseudo-TTY passes that test while Ink independently decides the mount
 * is non-interactive; `clear()` then does nothing and `unmount()` flushes
 * the last frame into stdout, in front of output a caller was parsing.
 * Agreeing with Ink is the whole job of this predicate.
 */
export function canRenderLiveOutput(capabilities: TerminalCapabilities): boolean {
  return capabilities.stdoutIsTTY && !capabilities.ci
}

/**
 * Convenience for call sites that just want the answer for this process.
 *
 * Note what this does NOT decide: frozen-lockfile mode never prompts even
 * on a fully interactive terminal, because reproducing recorded intent
 * must not collect new decisions. That is a policy question, so it stays
 * at the call site rather than being folded in here.
 */
export function canPromptInteractively(): boolean {
  return isInteractive(currentTerminalCapabilities())
}
