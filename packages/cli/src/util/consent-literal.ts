/**
 * The one escaped rendering for values on an MCP consent surface.
 *
 * A consent surface shows a user the exact command a tool will run, or the
 * exact endpoint it will dial, so they can decide whether to authorize it. Two
 * things follow, and joining raw strings with spaces satisfies neither:
 *
 *   1. **The display must be injective.** `['a b']` and `['a', 'b']` are
 *      different launches; rendered by joining, they are the same line. So is
 *      an empty argument, which disappears entirely. A user cannot approve
 *      what they cannot distinguish.
 *   2. **The value must not be able to forge the surrounding output.** A
 *      newline in an environment value adds a line to the report; an ANSI
 *      sequence can move the cursor, recolor a heading, or erase the line
 *      above it. Both let a declaration impersonate the tool asking about it.
 *
 * So every value is delimited and escaped, and nothing is elided: escaping
 * preserves the complete value, unlike redaction, which would ask a user to
 * approve something they were shown a summary of.
 *
 * The representation is JSON's, chosen because it is exactly the one a reader
 * already knows how to decode by eye, and because the values being displayed
 * came out of a JSON document in the first place. It is extended past what
 * `JSON.stringify` escapes: that function leaves DEL, the C1 range, line and
 * paragraph separators, zero-width characters, and bidirectional overrides
 * literal, and every one of those either draws nothing or changes how the rest
 * of the line is drawn.
 */

/**
 * Characters `JSON.stringify` emits verbatim that a terminal does not render
 * verbatim.
 *
 *   - `\u007f`               — DEL.
 *   - `\u0080`–`\u009f`      — the C1 controls, including CSI at `\u009b`.
 *   - `\u2028`, `\u2029`     — line and paragraph separators.
 *   - `\u200b`–`\u200f`      — zero-width characters and LTR/RTL marks.
 *   - `\u202a`–`\u202e`      — bidirectional embedding and override.
 *   - `\u2066`–`\u2069`      — bidirectional isolates.
 *   - `\ufeff`               — zero-width no-break space.
 */
const UNSAFE_PATTERN = /[\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/**
 * One value, delimited and escaped so it can be read but cannot act.
 *
 * Always quoted, including for a value that needs no escaping: a conditional
 * quote would make `"a b"` and `a b` two renderings of one value and reopen
 * the ambiguity the quoting exists to close.
 */
export function consentLiteral(value: string): string {
  return JSON.stringify(value).replaceAll(UNSAFE_PATTERN, (character) => escapeUnit(character))
}

function escapeUnit(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
}

/** A command and its ordered arguments, each delimited separately. */
export function consentCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(consentLiteral).join(' ')
}

/** One environment assignment, with the name and the value each delimited. */
export function consentEnvironmentAssignment(name: string, value: string): string {
  return `${consentLiteral(name)}=${consentLiteral(value)}`
}
