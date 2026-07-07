import { parseFacetName } from '@agent-facets/protocol'

/**
 * Default registry base URL. Overridable via `FACET_REGISTRY_URL`.
 *
 * Note: the URL is the *origin* — it does NOT include a `/v0` path
 * prefix. The OpenAPI-generated paths (`/v0/health`, `/v0/packages`,
 * etc.) carry the version segment themselves, and `openapi-fetch`
 * concatenates `baseUrl + path` to produce the final URL. Including
 * `/v0` in the base would double the prefix.
 */
const DEFAULT_REGISTRY_URL = 'https://api.agentfacets.io'

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

/**
 * A canonical facet name split into the path components the registry's
 * OpenAPI routes expect.
 *
 * The registry models scoped facets as two separate path segments — a
 * literal `@scope` segment and a bare `name` segment (`/v0/facets/{scope}/
 * {name}/...`) — NOT as one `{name}` parameter carrying a slash. Collapsing
 * `@scope/name` into a single param percent-encodes the `/` to `%2F`, which
 * the registry rejects with `E_INVALID_NAME`. So scoped requests MUST use
 * the scoped routes with `scope` and `name` as independent params.
 */
export type RegistryFacetRoute = { kind: 'unscoped'; name: string } | { kind: 'scoped'; scope: string; name: string }

/**
 * Split a canonical facet name into registry route components.
 *
 * Uses protocol's `parseFacetName` — the single source of truth for facet
 * identity grammar — so the scope/name split here always agrees with how
 * the name was validated at manifest and source-parse time. `scope` carries
 * the leading `@` exactly as the registry's `{scope}` parameter expects.
 *
 * The input is assumed to already be a valid facet identity (it has passed
 * source parsing or manifest validation). If it somehow isn't, it is treated
 * as an unscoped name verbatim so the caller still issues a well-formed (if
 * ultimately 404-ing) request rather than throwing.
 */
export function facetNameToRoute(name: string): RegistryFacetRoute {
  const parsed = parseFacetName(name)
  if (parsed.ok && parsed.value.kind === 'scoped') {
    return { kind: 'scoped', scope: `@${parsed.value.scope}`, name: parsed.value.name }
  }
  return { kind: 'unscoped', name }
}
