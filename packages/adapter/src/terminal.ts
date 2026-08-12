/**
 * The one escaped rendering for a declaration value reaching a terminal.
 *
 * A consent surface shows a user the exact command a tool will run, or the
 * exact endpoint it will dial, so they can decide whether to authorize it. A
 * diagnostic shows the one value that explains a failure. Both have the same
 * two obligations, and joining raw strings with spaces satisfies neither:
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
 * It lives in the SDK rather than in one consumer because an adapter's failure
 * data is structured — a conflict carries the offending value, not a sentence
 * containing it — and every surface that reproduces such a value must render
 * it the same way. A second implementation is a second answer to "is this
 * safe to print", which is exactly the question that must have one answer.
 *
 * The representation is JSON's, chosen because it is exactly the one a reader
 * already knows how to decode by eye, and because the values being displayed
 * came out of a JSON document in the first place.
 */

/**
 * Everything `JSON.stringify` leaves literal that is not printable ASCII.
 *
 * Deliberately an allowlist rather than a list of known-dangerous characters.
 * A denylist has to be right about every alphabet: it missed `\u061c`, which
 * reorders the line around it, and `\u2060`, which draws nothing at all, and
 * would have gone on missing whatever Unicode adds next. Restricting the
 * output to `\u0020`-`\u007e` is the only rule that cannot go stale, and the
 * cost — a non-ASCII value renders escaped rather than readable — is the right
 * trade on a surface whose entire purpose is that what you see is what you get.
 *
 * Matching is per UTF-16 code unit, so an astral character becomes its two
 * surrogates. That keeps the rendering reversible: `JSON.parse` of the result
 * reconstructs the pair, and therefore the original string, exactly.
 */
const NON_PRINTABLE_ASCII = /[^\u0020-\u007e]/g

/**
 * One value, delimited and escaped so it can be read but cannot act.
 *
 * Always quoted, including for a value that needs no escaping: a conditional
 * quote would make `"a b"` and `a b` two renderings of one value and reopen
 * the ambiguity the quoting exists to close.
 *
 * The result contains printable ASCII only, and `JSON.parse` of it returns the
 * exact input.
 */
export function terminalLiteral(value: string): string {
  // `JSON.stringify` first, so quotes, backslashes, and the C0 controls it
  // knows shorter escapes for keep them. The allowlist pass then catches
  // everything it leaves literal: DEL, the C1 range, and all non-ASCII.
  return JSON.stringify(value).replaceAll(NON_PRINTABLE_ASCII, (character) => escapeUnit(character))
}

function escapeUnit(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
}

/** A command and its ordered arguments, each delimited separately. */
export function terminalCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(terminalLiteral).join(' ')
}

/** One environment assignment, with the name and the value each delimited. */
export function terminalEnvironmentAssignment(name: string, value: string): string {
  return `${terminalLiteral(name)}=${terminalLiteral(value)}`
}
