/**
 * The value comparisons every native MCP rendering needs.
 *
 * Each adapter answers "is this native entry the rendering of that portable
 * declaration?" against a different document format, but the leaf comparisons
 * are the same three questions every time: is this an object we can read, is
 * this the same ordered list of strings, is this the same map of strings.
 * Three copies of them drifted apart once already — one adapter treating an
 * absent collection as unequal to an empty one is exactly the kind of
 * difference that shows up as a spurious re-prompt rather than a failure.
 */

/** Whether a parsed value is a readable object rather than an array or null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a parsed value is exactly this ordered list of strings.
 *
 * An absent value equals an empty list: an omitted optional collection and an
 * empty one describe the same launch in every format the first-party adapters
 * write.
 */
export function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  if (value === undefined) return expected.length === 0
  if (!Array.isArray(value) || value.length !== expected.length) return false
  return value.every((item, index) => item === expected[index])
}

/** Whether a parsed value is exactly this map of string assignments. */
export function sameStringRecord(value: unknown, expected: Readonly<Record<string, string>>): boolean {
  const expectedKeys = Object.keys(expected)
  if (value === undefined) return expectedKeys.length === 0
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== expectedKeys.length) return false
  return keys.every((key) => value[key] === expected[key])
}
