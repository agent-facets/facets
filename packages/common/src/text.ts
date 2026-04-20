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
