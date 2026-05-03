/**
 * Default registry base URL. Overridable via `FACET_REGISTRY_URL`.
 *
 * Note: the URL is the *origin* — it does NOT include a `/v0` path
 * prefix. The OpenAPI-generated paths (`/v0/health`, `/v0/packages`,
 * etc.) carry the version segment themselves, and `openapi-fetch`
 * concatenates `baseUrl + path` to produce the final URL. Including
 * `/v0` in the base would double the prefix.
 */
const DEFAULT_REGISTRY_URL = 'https://api.facet.cafe'

/**
 * Resolve the registry base URL from env, stripping any trailing slash so
 * callers can append paths without double-slashing.
 *
 * Lives in core because both the install pipeline (resolve-metadata,
 * download) and the CLI's standalone helpers (search, publish) need to
 * agree on the URL — duplicating the constant invites silent drift.
 */
export function getRegistryBaseUrl(): string {
  const fromEnv = process.env.FACET_REGISTRY_URL
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_REGISTRY_URL
  return raw.replace(/\/+$/, '')
}

/**
 * Encode a canonical facet name for use in a URL path. Namespaced names
 * like `acme/cowsay` become `acme%2Fcowsay` (npm-style); bare names pass
 * through unchanged.
 *
 * Centralized so every call site encodes identically — silent mismatches
 * between client and server URL forms are notoriously hard to debug.
 */
export function encodeFacetName(name: string): string {
  return encodeURIComponent(name)
}
