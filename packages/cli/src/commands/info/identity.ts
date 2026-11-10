/** The verified owner of a facet name, as the registry reports it. */
export type VerifiedOwner = { kind: 'user'; username: string } | { kind: 'org'; slug: string }

/**
 * Characters a registry username or org slug may render with. Anything
 * else (spaces, control characters, markup) drops the identity rather
 * than letting a malformed response forge the verified `@` position.
 */
const IDENTITY_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/**
 * Header segments for who made the facet.
 *
 * `by "<author>"` is the manifest's free text, quoted, with backslashes and
 * quotes escaped so it cannot close its own quotes and continue as another segment. The `@` form is
 * reserved for names the registry verified, and always sits in its own
 * `published by` segment, so a self-declared `"author": "@x"` or
 * `"author": "x · published by @y"` can never read as a verified identity.
 */
export function identitySegments(
  author: string | undefined,
  identity: { owner: VerifiedOwner; publisher: string } | undefined,
): string[] {
  const segments: string[] = []
  const shown = author?.replace(/\s+/g, ' ').trim()
  if (shown !== undefined && shown.length > 0)
    segments.push(`by "${shown.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
  if (identity !== undefined && IDENTITY_NAME.test(identity.publisher)) {
    const owner = identity.owner
    if (owner.kind === 'org' && IDENTITY_NAME.test(owner.slug)) {
      segments.push(`@${owner.slug}, published by @${identity.publisher}`)
    } else {
      segments.push(`published by @${identity.publisher}`)
    }
  }
  return segments
}
