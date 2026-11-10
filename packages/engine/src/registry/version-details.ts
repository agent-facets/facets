import { translateThrownError, translateWireError } from './client.ts'
import { describeVersionSpec } from './describe.ts'
import { facetNameToRoute } from './http.ts'
import { metadataFromWire } from './metadata-wire.ts'
import { openRegistryReadClient, type RegistryReadClientOptions } from './read-client.ts'
import type { RegistryResult, RegistrySpec } from './types.ts'
import type { WireMetadataResponse } from './wire.ts'

/** The verified identity that owns a facet name. */
export type RegistryOwner = { kind: 'user'; username: string } | { kind: 'org'; slug: string }

/** What the registry publishes about one exact version, beyond what install needs. */
export interface RegistryVersionDetails {
  name: string
  /** Exact `MAJOR.MINOR.PATCH`, even when `latest` or a wildcard was requested. */
  version: string
  contentFingerprint: string
  /** Free text from the publisher's manifest; never verified. */
  author?: string
  description?: string
  owner: RegistryOwner
  /** Verified username of the account that published this version. */
  publisher: string
  publishedAt: string
  /** The published `facet.json`, unparsed. */
  manifestJson: string
}

/**
 * Read one version's published details: description, free-text author,
 * verified owner and publisher, and the full manifest.
 */
export async function fetchRegistryVersionDetails(
  spec: RegistrySpec,
  options: RegistryReadClientOptions = {},
): Promise<RegistryResult<RegistryVersionDetails>> {
  const opened = await openRegistryReadClient(options)
  if (!opened.ok) return opened
  const client = opened.value

  const versionForUrl = describeVersionSpec(spec.version)
  const route = facetNameToRoute(spec.name)
  try {
    const { data, error, response } =
      route.kind === 'scoped'
        ? await client.GET('/v0/facets/{scope}/{name}/{version}', {
            params: { path: { scope: route.scope, name: route.name, version: versionForUrl } },
          })
        : await client.GET('/v0/facets/{name}/{version}', {
            params: { path: { name: route.name, version: versionForUrl } },
          })
    if (error !== undefined) {
      return { ok: false, error: translateWireError(error, response.status, { name: spec.name, spec: versionForUrl }) }
    }
    return versionDetailsFromWire(data, spec)
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}

/**
 * Map a metadata body to `RegistryVersionDetails`, checking it against
 * the request that produced it.
 *
 * Identity, exact version, and both hashes go through `metadataFromWire`
 * so this read and install agree on what a valid response is. The
 * identity fields are checked here because `openapi-fetch` does not
 * validate responses, and a missing publisher must never render as an
 * empty or `undefined` verified name.
 *
 * Exported for unit testing.
 */
export function versionDetailsFromWire(
  body: WireMetadataResponse,
  requested: RegistrySpec,
): RegistryResult<RegistryVersionDetails> {
  const checked = metadataFromWire(body, requested)
  if (!checked.ok) return checked

  if (!isNonEmptyString(body.manifest_json)) return contractViolation(body, 'is missing its manifest_json')
  if (!isNonEmptyString(body.publisher)) return contractViolation(body, 'is missing its verified publisher')
  if (!isNonEmptyString(body.published_at)) return contractViolation(body, 'is missing published_at')
  const owner = ownerFromWire(body.owner)
  if (owner === undefined) return contractViolation(body, 'has a missing or malformed owner')

  return {
    ok: true,
    value: {
      name: checked.value.name,
      version: checked.value.version,
      contentFingerprint: checked.value.contentFingerprint,
      ...(isNonEmptyString(body.author) ? { author: body.author } : {}),
      ...(isNonEmptyString(body.description) ? { description: body.description } : {}),
      owner,
      publisher: body.publisher,
      publishedAt: body.published_at,
      manifestJson: body.manifest_json,
    },
  }
}

function ownerFromWire(owner: unknown): RegistryOwner | undefined {
  if (typeof owner !== 'object' || owner === null || !('kind' in owner)) return undefined
  if (owner.kind === 'user' && 'username' in owner && isNonEmptyString(owner.username)) {
    return { kind: 'user', username: owner.username }
  }
  if (owner.kind === 'org' && 'slug' in owner && isNonEmptyString(owner.slug)) {
    return { kind: 'org', slug: owner.slug }
  }
  return undefined
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function contractViolation(
  body: { name: string; version: string },
  detail: string,
): { ok: false; error: { code: 'UNEXPECTED_ERROR'; cause: string } } {
  return {
    ok: false,
    error: { code: 'UNEXPECTED_ERROR', cause: `registry metadata for ${body.name}@${body.version} ${detail}` },
  }
}
