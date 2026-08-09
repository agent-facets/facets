import type { McpConsentPolicy, McpConsentResolver } from '@agent-facets/engine'
import type { FlagDef } from '../../commands.ts'

/**
 * The flag name a user types to pre-approve MCP server configuration.
 *
 * Declared once and referenced everywhere it appears — the flag table,
 * the remediation line that tells a failed non-interactive run how to
 * retry, and any test asserting help output. A literal repeated across
 * those surfaces is a rename waiting to leave one of them stale, and the
 * one most likely to be missed is the `fix:` line, which is exactly the
 * text a blocked user is reading.
 */
export const ACCEPT_MCP_FLAG = 'accept-mcp'

/**
 * Flags shared by every command that can enter the install pipeline.
 *
 * `add`, `install`, and `remove` are three front doors to one
 * orchestrator, so a flag that governs pipeline behavior belongs to all
 * three or to none. `--accept-mcp` in particular must be on `remove`:
 * a removal that has to resolve the facets it keeps re-enters the same
 * consent path as an install, and a user who cannot pre-approve there
 * has no non-interactive way to finish the operation.
 */
export const INSTALL_PIPELINE_FLAGS: Record<string, FlagDef> = {
  verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
  [ACCEPT_MCP_FLAG]: {
    type: 'boolean',
    description: 'Approve the MCP server configuration this operation would write, without prompting',
  },
}

/**
 * Choose the MCP consent policy for one run.
 *
 * Returns a total policy rather than an optional one. The engine already
 * treats an absent option as `unavailable`, so returning `undefined` for
 * "cannot answer" would encode the same fact twice — once by omission
 * here and once by a default there — and let the two disagree.
 *
 * The flag outranks the prompt. Pre-approval is a stated intent, not a
 * fallback for a missing terminal: a user who passes it on a TTY meant
 * it, and prompting anyway would make the flag mean nothing there.
 *
 * `mayPrompt` is the caller's, because only it knows the mode. For
 * `install` it must already exclude frozen: frozen may *use* an approval
 * supplied up front but must never *collect* one. The engine independently
 * downgrades an interactive policy under frozen, so the prompting arm is
 * unreachable there even if a caller got this wrong.
 *
 * Approving a server's command says nothing about overwriting a file, so
 * no asset collision or asset takeover decision is derived from this
 * value. Those keep their own resolvers and their own screens.
 */
export function mcpConsentPolicy(options: {
  acceptMcp: boolean
  mayPrompt: boolean
  resolve: McpConsentResolver
}): McpConsentPolicy {
  if (options.acceptMcp) return { kind: 'preapproved' }
  if (options.mayPrompt) return { kind: 'interactive', resolve: options.resolve }
  return { kind: 'unavailable' }
}
