/**
 * Serialize a value as the canonical on-disk JSON text for files this
 * toolchain generates: 2-space indentation (per ADR-006) and a trailing
 * newline, so generated files stay byte-stable in editors that
 * auto-append a final newline.
 *
 * Every engine writer that emits a JSON file MUST serialize through this
 * helper. The one exception is `serializeFacetsJson`, which must go
 * through comment-json to preserve comments and independently upholds
 * the same invariant.
 */
export function jsonFileText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
