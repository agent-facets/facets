/**
 * POSIX-shell argument quoting for commands the CLI renders as copy/paste
 * fix lines. Mirrors Python's `shlex.quote`: values made only of shell-inert
 * characters pass through untouched, everything else is single-quoted with
 * embedded single quotes spliced as `'\''`.
 */

/** Charset mirror of shlex.quote: these characters never need quoting. */
const SAFE_ARG_RE = /^[A-Za-z0-9@%+=:,./_-]+$/

/**
 * Quote one argument so it pastes safely into a POSIX shell (sh/bash/zsh).
 * Ordinary npm specifiers (`opencode`, `@scope/name`, `name@1.2.3`) render
 * unchanged; paths with whitespace, glob selectors like `name@1.*`, git
 * URLs with `#`, and metacharacters are single-quoted. Empty strings render
 * as `''` so the argument doesn't vanish.
 */
export function quoteShellArg(arg: string): string {
  if (arg === '') return "''"
  if (SAFE_ARG_RE.test(arg)) return arg
  return `'${arg.replaceAll("'", `'\\''`)}'`
}
