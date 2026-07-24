/**
 * Canonical README support shared by scaffold (`facet create`) and edit
 * (`facet edit`). Both conventional paths are recognized as first-class facet
 * documents; `README.md` is the preferred authored form and the default for
 * new creation. Neither gets a README-specific manifest field — they are
 * ordinary top-level `files` declarations.
 */

/** The preferred conventional README path and the default for new creation. */
export const README_MD = 'README.md'

/** The extensionless conventional README path, also first-class. */
export const README_EXTENSIONLESS = 'README'

/** Both exact conventional README paths, each managed independently. */
export const README_PATHS = [README_MD, README_EXTENSIONLESS] as const

export type ReadmePath = (typeof README_PATHS)[number]

/** True for exactly the two conventional README paths. */
export function isReadmePath(path: string): path is ReadmePath {
  return path === README_MD || path === README_EXTENSIONLESS
}

/**
 * Seed initial `README.md` content from the facet identity. This is an initial
 * value only: once an author edits it, callers MUST preserve the authored bytes
 * and MUST NOT re-seed from later identity edits.
 */
export function readmeTemplate(name: string, description: string): string {
  const heading = `# ${name}\n`
  const body = description.trim().length > 0 ? `\n${description.trim()}\n` : ''
  return `${heading}${body}`
}
