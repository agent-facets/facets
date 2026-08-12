import { applyEdits, type FormattingOptions, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser'

/**
 * Targeted editing for the JSON-family documents adapters share.
 *
 * Two first-party tools keep their MCP servers in a document a user also
 * hand-edits: OpenCode reads JSONC, Claude Code reads strict JSON. Reserializing
 * either one on a single-entry change reflows everything the user arranged —
 * comments, compact arrays, inline objects, deliberate blank lines — so both
 * need a syntax-aware edit that touches only the property being changed.
 *
 * That is one mechanism, so it lives in one place. It is private to this
 * workspace and consumed as source: `jsonc-parser`'s types never cross into an
 * adapter's public surface, and each adapter's bundler inlines this package the
 * way it already inlines the SDK.
 *
 * Parsing and editing are deliberately separate. Claude Code must keep
 * validating with `JSON.parse` — a comment is a document Claude Code itself
 * rejects, so tolerating it here would silently "fix" a file the tool was
 * already ignoring — while still editing through the syntax-aware path.
 */

/** How a document is laid out, so an inserted member does not look pasted in. */
export type JsoncFormatting = FormattingOptions

/** The result of splitting a byte-order mark off a document. */
export interface JsoncDocumentText {
  /** Whether the original text began with a byte-order mark. */
  readonly bom: boolean
  /** The document text with any byte-order mark removed. */
  readonly body: string
}

/**
 * Split a leading byte-order mark from a document.
 *
 * Every parser here would treat a leading mark as a syntax error, and every
 * writer must put it back: dropping it rewrites a file the user's editor will
 * simply add it to again on the next save.
 */
export function splitJsoncBom(text: string): JsoncDocumentText {
  return text.charCodeAt(0) === 0xfeff ? { bom: true, body: text.slice(1) } : { bom: false, body: text }
}

/** Re-attach a byte-order mark that {@link splitJsoncBom} removed. */
export function restoreJsoncBom(body: string, bom: boolean): string {
  return bom ? `\uFEFF${body}` : body
}

/**
 * Match the document's own indentation and line endings.
 *
 * The unit is the *shallowest* indentation the document uses, because that is
 * the one that is a single level. Taking the first indented line instead reads
 * whichever line happens to come first — a nested member, a hand-aligned
 * comment, a closing brace on its own line — and infers a unit from it. That
 * is not cosmetic: the editor re-indents the whole line an edit lands on using
 * this size, so a document whose first indented line sits four levels deep
 * comes back with its `mcp` member shifted to a column no one chose.
 *
 * Exactly one unit is inferred, since that is all a syntax-aware edit accepts.
 * A document that indents inconsistently deeper down keeps every line outside
 * the edited range byte-for-byte; only the edited range is laid out with this
 * unit. A tie between equally shallow runs goes to the first, so the answer
 * does not depend on iteration order.
 *
 * A brand-new document gets two spaces, which is what both target tools write
 * when they bootstrap a configuration of their own.
 */
export function detectJsoncFormatting(text: string | null): JsoncFormatting {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n'
  const indent = shallowestIndent(text)
  if (indent === undefined) return { tabSize: 2, insertSpaces: true, eol }
  if (indent.startsWith('\t')) return { tabSize: 2, insertSpaces: false, eol }
  return { tabSize: indent.length, insertSpaces: true, eol }
}

/**
 * The shortest leading whitespace run on a line that begins a member.
 *
 * Three kinds of line are skipped, because none of them is a member and each
 * one is routinely shallower than the members around it — so counting them
 * would drag the inferred unit below the document's real step:
 *
 *   - Blank and whitespace-only lines carry nothing to be indented.
 *   - A line starting with `}`, `]`, or `,` closes or separates a structure,
 *     so it sits at the *parent's* level by construction.
 *   - A line starting with `/` is a comment, whose indentation the author is
 *     free to align with anything at all.
 *
 * A `\r` before the line break is not part of the indent, which the `[ \t]`
 * class already ensures.
 */
function shallowestIndent(text: string | null): string | undefined {
  if (text === null || text === undefined) return undefined
  let shallowest: string | undefined
  for (const [, indent] of text.matchAll(/\n([ \t]+)(?=[^ \t\r\n\]},/])/g)) {
    if (indent === undefined) continue
    if (shallowest === undefined || indent.length < shallowest.length) shallowest = indent
  }
  return shallowest
}

/**
 * Set or delete one property, returning the edited text.
 *
 * `undefined` deletes. Edits are applied one at a time by design: an edit
 * carries absolute offsets into the text it was computed against, so a batch
 * computed against the original document would corrupt everything after the
 * first change.
 */
export function editJsoncProperty(
  text: string,
  path: readonly (string | number)[],
  value: unknown,
  formatting: JsoncFormatting,
): string {
  return applyEdits(text, modify(text, [...path], value, { formattingOptions: formatting }))
}

/** A parsed JSONC document, or a description of why it could not be parsed. */
export type ParseJsoncResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string }

/**
 * Parse a JSONC document, tolerating comments and trailing commas.
 *
 * For a tool that reads JSONC this is the whole story. For a tool that reads
 * strict JSON, this is the wrong validator — use `JSON.parse` for validation
 * and this package only for the edit.
 */
export function parseJsoncDocument(text: string): ParseJsoncResult {
  const errors: ParseError[] = []
  const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
  const first = errors[0]
  if (first === undefined) return { ok: true, value }
  return { ok: false, message: describeJsoncParseError(text, first.offset) }
}

/** A one-line, line-numbered description of a parse failure. */
export function describeJsoncParseError(text: string, offset: number): string {
  const line = text.slice(0, offset).split('\n').length
  return `invalid JSONC at line ${line} (offset ${offset})`
}
