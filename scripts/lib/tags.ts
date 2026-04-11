/**
 * Version tag parsing utility — shared between library and CLI release pipelines.
 */

/**
 * Parse a version tag into package name and version.
 * Handles both scoped (`@scope/name@1.0.0`) and unscoped (`name@1.0.0`) tags.
 */
export function parseTag(tag: string): { name: string; version: string } | null {
  const scoped = tag.match(/^(@[^@]+)@(\d+\..+)$/)
  if (scoped?.[1] && scoped[2]) return { name: scoped[1], version: scoped[2] }

  const unscoped = tag.match(/^([^@]+)@(\d+\..+)$/)
  if (unscoped?.[1] && unscoped[2]) return { name: unscoped[1], version: unscoped[2] }

  return null
}
