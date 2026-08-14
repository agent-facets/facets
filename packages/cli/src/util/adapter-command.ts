import { quoteShellArg } from './shell-quote.ts'

/**
 * The `facet adapter` command surface, in one place.
 *
 * `add` is the canonical verb for installing an adapter; `install` is a
 * deprecated alias that still dispatches so muscle memory keeps working.
 * Every string the CLI renders back to a user — usage lines, unknown-
 * subcommand recovery, repair commands, the deprecation notice — derives
 * from the constants here, so the canonical spelling cannot drift between
 * surfaces or fall out of step with what the router actually accepts.
 *
 * Only the *command word* lives here. The operation it performs is still
 * an installation everywhere else (`installAdapter`, installation
 * receipts, "Installing adapter…" progress), and that vocabulary is
 * deliberately left alone.
 */

/** Canonical subcommand that installs an adapter. */
export const ADAPTER_ADD_SUBCOMMAND = 'add'

/** Deprecated spelling of {@link ADAPTER_ADD_SUBCOMMAND}. Still dispatches. */
export const ADAPTER_INSTALL_SUBCOMMAND = 'install'

/** Advertised subcommands, in help order. The deprecated alias is not advertised. */
export const ADAPTER_SUBCOMMANDS = [ADAPTER_ADD_SUBCOMMAND, 'list', 'remove'] as const

const [FIRST_SUBCOMMAND, SECOND_SUBCOMMAND, THIRD_SUBCOMMAND] = ADAPTER_SUBCOMMANDS

/** `<add|list|remove>` — the usage fragment for `facet adapter`. */
export const ADAPTER_SUBCOMMAND_USAGE = `<${ADAPTER_SUBCOMMANDS.join('|')}>`

/** `add, list, or remove` — the prose list for recovery messages. */
export const ADAPTER_SUBCOMMAND_LIST = `${FIRST_SUBCOMMAND}, ${SECOND_SUBCOMMAND}, or ${THIRD_SUBCOMMAND}`

/** `facet adapter add` — the canonical command, with no argument. */
export const ADAPTER_ADD_COMMAND = `facet adapter ${ADAPTER_ADD_SUBCOMMAND}`

/** `facet adapter install` — the deprecated alias, with no argument. */
export const ADAPTER_INSTALL_COMMAND = `facet adapter ${ADAPTER_INSTALL_SUBCOMMAND}`

/**
 * The one-line notice written to stderr when the deprecated alias runs.
 * It is the only observable difference between the two spellings: stdout,
 * side effects, and the exit code are identical.
 */
export const ADAPTER_INSTALL_DEPRECATION_WARNING = `warning: '${ADAPTER_INSTALL_COMMAND}' is deprecated; use '${ADAPTER_ADD_COMMAND}' instead.`

/**
 * Render the canonical command with a concrete target. Targets are
 * user/source-derived (receipt specifiers, local paths, package names)
 * and must paste back into a shell safely.
 */
export function adapterAddCommand(target: string): string {
  return `${ADAPTER_ADD_COMMAND} ${quoteShellArg(target)}`
}

/** The placeholders guidance uses when it has no concrete target to name. */
export type AdapterAddPlaceholder = '<name>' | '<specifier>'

/**
 * Render the canonical command with a literal placeholder. Placeholders
 * are prose, not arguments, so they are never shell-quoted — which is
 * exactly why they cannot go through {@link adapterAddCommand}.
 */
export function adapterAddCommandFor(placeholder: AdapterAddPlaceholder): string {
  return `${ADAPTER_ADD_COMMAND} ${placeholder}`
}
