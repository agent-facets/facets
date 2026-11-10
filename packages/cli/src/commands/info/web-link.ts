const DEFAULT_WEB_ORIGIN = 'https://agentfacets.io'
const DEFAULT_REGISTRY_ORIGIN = 'https://api.agentfacets.io'

export type WebLink = { kind: 'link'; url: string } | { kind: 'none' } | { kind: 'invalid-override'; value: string }

/**
 * The facet's page on the website, built only from a trusted origin and
 * the facet's validated name.
 *
 * A registry other than the default suppresses the link unless
 * `FACET_WEB_URL` names the matching site: linking a dev registry's
 * facet to production would point at a page that may not exist.
 */
export function facetWebLink(name: string, env: Record<string, string | undefined> = process.env): WebLink {
  const override = env.FACET_WEB_URL
  if (override !== undefined && override.length > 0) {
    const origin = httpsOrigin(override)
    return origin === undefined
      ? { kind: 'invalid-override', value: override }
      : { kind: 'link', url: pageUrl(origin, name) }
  }
  const registry = env.FACET_REGISTRY_URL
  if (registry !== undefined && registry.length > 0 && httpsOrigin(registry) !== DEFAULT_REGISTRY_ORIGIN) {
    return { kind: 'none' }
  }
  return { kind: 'link', url: pageUrl(DEFAULT_WEB_ORIGIN, name) }
}

function pageUrl(origin: string, name: string): string {
  return `${origin}/facets/${name}`
}

function httpsOrigin(value: string): string | undefined {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return undefined
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
    return url.origin
  } catch {
    return undefined
  }
}
