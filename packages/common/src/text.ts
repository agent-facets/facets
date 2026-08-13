/**
 * Small text-normalization helpers used across packages that parse
 * user-authored files. Lives in `common` so core front-matter parsing and
 * the adapter SDK's asset-fs helpers can share one definition — Windows
 * line endings or a stray BOM shouldn't cause divergent behavior across
 * readers.
 */

/**
 * Strip a leading UTF-8 BOM and convert any `\r\n` / `\r` line endings to
 * `\n`. Idempotent. Returns the string unchanged if already normalized.
 */
export function normalizeLineEndings(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/**
 * Decode a file's bytes as text, keeping a leading byte-order mark.
 *
 * `ignoreBOM` reads backwards: it leaves the mark in the string rather than
 * consuming it. Silently eating it would make a document that starts with one
 * indistinguishable from one that does not — so a parser could not put it
 * back, and a validator that rejects it would start accepting it.
 */
export function decodeFileText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}
