import { hexToRgb, THEME } from '@agent-facets/brand'

/**
 * Single entry point for user-visible error output from add/install/picker
 * paths (Adjustment N). Emits a 3-line block to stderr:
 *
 *   error: <what>
 *     <detail>
 *     fix: <action>
 *
 * `error:` and `fix:` labels render in THEME.warning when the stream is a
 * TTY and NO_COLOR is unset. All other text is plain so partners can copy
 * terminal output verbatim for bug reports.
 *
 * The block is always three lines. If `detail` is omitted or empty the
 * middle line renders as `  (no detail)` rather than collapsing — this keeps
 * error output grep-friendly and visually uniform in partner bug reports.
 */

export interface CliError {
  /** One-line description of what failed. */
  what: string
  /**
   * Optional one-line why / specific detail. Omit (or pass an empty string)
   * to render the middle line as `(no detail)` — the block stays three
   * lines either way.
   */
  detail?: string
  /** One-line action the user should take to unblock themselves. */
  fix: string
  /**
   * Optional canonical docs URL for the error. When present, renders as a
   * fourth line `  docs: <url>` so users can deep-link from terminal output
   * to documentation. Used by registry error translations.
   */
  docsUrl?: string
}

/**
 * Format a CliError as the canonical stderr block. Three lines normally;
 * four when `docsUrl` is provided. Exposed for tests and for callers that
 * want to control writing (e.g., Ink cleanup paths that write after unmount).
 */
export function formatCliError(err: CliError): string {
  const detail = err.detail && err.detail.length > 0 ? err.detail : '(no detail)'
  const errorLabel = colorize('error:', THEME.warning)
  const fixLabel = colorize('fix:', THEME.warning)
  const lines = [`${errorLabel} ${err.what}`, `  ${detail}`, `  ${fixLabel} ${err.fix}`]
  if (err.docsUrl !== undefined && err.docsUrl.length > 0) {
    const docsLabel = colorize('docs:', THEME.warning)
    lines.push(`  ${docsLabel} ${err.docsUrl}`)
  }
  return lines.join('\n')
}

/**
 * Write a CliError to stderr in the canonical 3-line format. Returns the
 * formatted string for callers that want to assert on it.
 */
export function writeCliError(err: CliError): string {
  const formatted = formatCliError(err)
  process.stderr.write(`${formatted}\n`)
  return formatted
}

function shouldColor(): boolean {
  if (process.env.NO_COLOR) return false
  return Boolean(process.stderr.isTTY)
}

function colorize(text: string, hex: string): string {
  if (!shouldColor()) return text
  const [r, g, b] = hexToRgb(hex)
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}
