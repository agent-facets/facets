import { createRegistryClient, translateThrownError, translateWireError } from './client.ts'
import { resolveCredential } from './credentials.ts'
import { describeVersionSpec } from './describe.ts'
import { facetNameToRoute } from './http.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from './types.ts'

// Note on path-parameter encoding:
//
// `openapi-fetch` encodes path parameters automatically. Passing a
// pre-encoded value (e.g., `acme%2Fcowsay`) results in double-encoding
// (`acme%252Fcowsay`). So we pass the raw `spec.name` to
// `params.path.name` and `client.GET` does the right thing.

/**
 * Resolve registry metadata for a batch of `(name, version)` pairs.
 *
 * V0 fans out concurrent per-spec fetches (no batch endpoint server-side
 * yet). Returns one RegistryMetadata per input spec in input order, or
 * surfaces NOT_FOUND / NETWORK_ERROR for the first failure encountered —
 * all-or-nothing semantics keep the caller-side branching simple. (No
 * partial-failure surface area in V0; if the demo is the use case, a
 * single facet is being resolved at a time anyway.)
 *
 * Empty input returns `{ ok: true, value: [] }`.
 *
 * Version specs are sent verbatim in the form the user wrote (`1.2.3`,
 * `1.*`, `1.2.*`, `*`, `latest`). The server is the authority on which
 * forms it can resolve; the client must not silently widen a constrained
 * spec. V0 currently only resolves exact versions and `latest` — every
 * other form returns NOT_FOUND, which we surface unchanged. (Once the
 * server gains range-resolution support, this code does not need to
 * change.) The semantic correctness of the contract belongs on the
 * client; the limits of what's resolvable belong on the server.
 */
export async function resolveRegistryMetadataBatch(
  specs: ReadonlyArray<RegistrySpec>,
): Promise<RegistryResult<ReadonlyArray<RegistryMetadata>>> {
  if (specs.length === 0) return { ok: true, value: [] }

  // Reads carry the credential opportunistically: when one is
  // available it earns the authenticated rate-limit tier; when absent
  // the reads proceed anonymously (see design D3).
  const cred = resolveCredential()
  const client = createRegistryClient({
    credential: cred.source === 'absent' ? undefined : cred.token,
  })
  const results = await Promise.all(specs.map((spec) => fetchOne(client, spec)))
  for (const r of results) {
    if (!r.ok) return r
  }
  return {
    ok: true,
    value: results.map((r) => {
      // Type narrowing for the all-ok case.
      if (!r.ok) throw new Error('unreachable: failure should have short-circuited')
      return r.value
    }),
  }
}

/**
 * Resolve a single `(name, version)` pair via the typed registry
 * client.
 *
 * The wire→internal mapping is intentional and load-bearing:
 *
 *   - `body.content_hash` becomes `transportHash`. It is the sha256 of
 *     the uploaded `.facet` archive (the uncompressed outer tar
 *     carrying `build-manifest.json` + the gzipped inner
 *     `archive.tar.gz`); `download.ts` uses it for the raw-bytes
 *     transport check.
 *   - `body.content_integrity` becomes `contentFingerprint`. It is the
 *     sha256 of the canonical archive (inner uncompressed tar) — the
 *     domain the sidecar, lockfile, and build-manifest all record. Fed
 *     to the three-check protocol as `expectedIntegrity` and used for
 *     integrity confirmation when creating a lockfile entry.
 *
 * No archive URL is computed here. The archive request is issued
 * just-in-time by `downloadAndExtractFacet` from the resolved
 * `name` + `version` (see Option 3 / design D1), so this function
 * returns only the published facts about the version.
 */
async function fetchOne(
  client: ReturnType<typeof createRegistryClient>,
  spec: RegistrySpec,
): Promise<RegistryResult<RegistryMetadata>> {
  // Surface form ('1.2.3', '1.*', '*', 'latest', etc.) is sent verbatim.
  // The server is responsible for accepting/rejecting; we don't widen.
  const versionForUrl = describeVersionSpec(spec.version)

  // Scoped names use the registry's two-segment scoped route
  // (`/v0/facets/{scope}/{name}/{version}`) with `scope` and `name` as
  // independent params, so the `/` is never collapsed into `%2F`. Unscoped
  // names keep the single-`{name}` route. openapi-fetch path-encodes each
  // segment independently.
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
      return {
        ok: false,
        error: translateWireError(error, response.status, {
          name: spec.name,
          spec: describeVersionSpec(spec.version),
        }),
      }
    }

    return metadataFromWire(data)
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}

/**
 * Map a wire metadata body to the internal `RegistryMetadata`, with a
 * runtime guard on the two hash fields.
 *
 * The generated types declare `content_hash` and `content_integrity`
 * as required strings, but `openapi-fetch` performs no response
 * validation — a stale CDN-cached pre-migration object (camelCase, no
 * `content_integrity`) deserializes with those fields `undefined`.
 * Propagating `undefined` into the integrity chain would silently
 * disable confirmation, so a missing or empty hash field fails closed
 * as a structured contract violation. Never fall back to the other
 * hash or skip the check (design D3a risk note).
 *
 * Exported for unit testing.
 */
export function metadataFromWire(body: {
  name: string
  version: string
  content_hash: string
  content_integrity: string
}): RegistryResult<RegistryMetadata> {
  if (!isNonEmptyString(body.content_hash)) {
    return contractViolation(body, 'content_hash')
  }
  if (!isNonEmptyString(body.content_integrity)) {
    return contractViolation(body, 'content_integrity')
  }
  return {
    ok: true,
    value: {
      name: body.name,
      version: body.version,
      transportHash: body.content_hash,
      contentFingerprint: body.content_integrity,
    },
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function contractViolation(
  body: { name: string; version: string },
  field: 'content_hash' | 'content_integrity',
): RegistryResult<RegistryMetadata> {
  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      cause:
        `registry metadata for ${body.name}@${body.version} is missing a usable ${field} ` +
        '(stale CDN-cached or non-conforming response); refusing to proceed without it',
    },
  }
}
