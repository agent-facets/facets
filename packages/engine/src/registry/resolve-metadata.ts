import { parseVersionSpec } from '../sources/facet/parse-version.ts'
import { createRegistryClient, translateThrownError, translateWireError } from './client.ts'
import { resolveCredential } from './credentials.ts'
import { describeVersionSpec } from './describe.ts'
import { facetNameToRoute } from './http.ts'
import type { RegistryMetadata, RegistryResult, RegistrySpec } from './types.ts'

/**
 * Most specifiers one `resolveRegistryMetadataBatch` call accepts.
 *
 * The cap exists so a caller with an unbounded amount of work (update
 * discovery, which asks for two specifiers per registry facet) has to
 * decide how to group and pace that work instead of opening one socket
 * per manifest entry. Callers import this constant rather than
 * hard-coding 100, so the grouping and the limit can never disagree.
 */
export const MAX_REGISTRY_METADATA_SPECIFIERS = 100

// Note on path-parameter encoding:
//
// `openapi-fetch` encodes path parameters automatically. Passing a
// pre-encoded value (e.g., `acme%2Fcowsay`) results in double-encoding
// (`acme%252Fcowsay`). So we pass the raw `spec.name` to
// `params.path.name` and `client.GET` does the right thing.

/**
 * Resolve registry metadata for a batch of `(name, version)` pairs.
 *
 * Returns one `RegistryMetadata` per input spec, in input order, or the
 * first failure in that same order. All-or-nothing: a caller never gets
 * a partially resolved set it could mistake for a complete answer.
 * Because the failure is chosen by input position rather than by which
 * request happened to settle first, the reported error is the same on
 * every run regardless of network timing.
 *
 * Empty input returns `{ ok: true, value: [] }` without resolving a
 * credential or touching the network. More than
 * `MAX_REGISTRY_METADATA_SPECIFIERS` specifiers returns
 * `TOO_MANY_SPECIFIERS`, also before any request is issued.
 *
 * TODO: the registry has no batch metadata endpoint yet, so this fans
 * out one concurrent request per specifier behind a single client. When
 * the planned batch endpoint ships, replace the fan-out here; callers
 * are already shaped for it because they group to the limit above.
 *
 * Version specs are sent verbatim in the form the user wrote (`1.2.3`,
 * `1.*`, `1.2.*`, `*`, `latest`) — all five forms the registry resolves,
 * with the server choosing which published version satisfies a wildcard.
 * The client must not silently widen a constrained spec: the semantic
 * correctness of the request belongs here, and the limits of what is
 * resolvable belong on the server.
 *
 * Every response is checked against the request that produced it before
 * it becomes a `RegistryMetadata` — see `metadataFromWire`.
 */
export async function resolveRegistryMetadataBatch(
  specs: ReadonlyArray<RegistrySpec>,
): Promise<RegistryResult<ReadonlyArray<RegistryMetadata>>> {
  if (specs.length === 0) return { ok: true, value: [] }
  if (specs.length > MAX_REGISTRY_METADATA_SPECIFIERS) {
    return {
      ok: false,
      error: {
        code: 'TOO_MANY_SPECIFIERS',
        limit: MAX_REGISTRY_METADATA_SPECIFIERS,
        received: specs.length,
      },
    }
  }

  // Reads carry the credential opportunistically: when one is
  // available it earns the authenticated rate-limit tier; when absent
  // the reads proceed anonymously (see design D3).
  //
  // Guarded like `fetchOne` below rather than left bare: reading the
  // credential touches the home directory and parses a file, and
  // creating the client validates a URL from the environment. Both are
  // environment failures a caller can act on, and neither may leave
  // this function through a channel its result type does not describe.
  let client: ReturnType<typeof createRegistryClient>
  try {
    const cred = resolveCredential()
    client = createRegistryClient({
      credential: cred.source === 'absent' ? undefined : cred.token,
    })
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
  const results = await Promise.all(specs.map((spec) => fetchOne(client, spec)))

  // One pass in input order: the first failure wins, and the success
  // list is built from the same narrowing that proved it. Scanning for
  // failures and then re-narrowing in a second pass would leave a
  // branch the compiler can't discharge and that can't happen.
  const resolved: RegistryMetadata[] = []
  for (const result of results) {
    if (!result.ok) return result
    resolved.push(result.value)
  }
  return { ok: true, value: resolved }
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

    return metadataFromWire(data, spec)
  } catch (err) {
    return { ok: false, error: translateThrownError(err) }
  }
}

/**
 * Map a wire metadata body to the internal `RegistryMetadata`, checking
 * it against the request that produced it.
 *
 * `openapi-fetch` performs no response validation — the generated types
 * are a compile-time claim about the schema, not a runtime guarantee
 * about the bytes that arrived. Four things are therefore established
 * here, all failing closed as structured contract violations:
 *
 *   - **Identity.** The body must describe the facet that was asked
 *     for. A response for some other name — a misrouted request, a
 *     mixed-up cache key — would otherwise install one facet's content
 *     under another facet's entry.
 *   - **Exact version.** The resolved version must be an exact
 *     `MAJOR.MINOR.PATCH` this CLI understands, parsed through the same
 *     grammar the manifest uses. A wildcard or tag coming back where a
 *     concrete version belongs means nothing downstream can treat the
 *     result as an immutable published identity.
 *   - **`content_hash`** and **`content_integrity`.** A stale
 *     CDN-cached pre-migration object (camelCase, no
 *     `content_integrity`) deserializes with these `undefined`.
 *     Propagating `undefined` into the integrity chain would silently
 *     disable confirmation, so a missing or empty hash fails closed.
 *     Never fall back to the other hash or skip the check (design D3a
 *     risk note).
 *
 * This does not check that the version *satisfies* the requested spec.
 * Whether `1.*` should have produced `1.8.0` is a question about the
 * caller's intent, and the caller that cares (update discovery) holds
 * the authored specifier and answers it there.
 *
 * Exported for unit testing.
 */
export function metadataFromWire(
  body: {
    name: string
    version: string
    content_hash: string
    content_integrity: string
  },
  requested: RegistrySpec,
): RegistryResult<RegistryMetadata> {
  if (!isNonEmptyString(body.name) || body.name !== requested.name) {
    return contractViolation(
      body,
      `identifies a different facet than the requested "${requested.name}"; ` +
        'refusing to resolve a facet the caller did not ask for',
    )
  }
  if (!isNonEmptyString(body.version) || !isExactVersion(body.version)) {
    return contractViolation(
      body,
      `did not resolve to an exact MAJOR.MINOR.PATCH version (requested ${describeVersionSpec(requested.version)}); ` +
        'refusing to proceed without an immutable published version',
    )
  }
  if (!isNonEmptyString(body.content_hash)) {
    return missingHashField(body, 'content_hash')
  }
  if (!isNonEmptyString(body.content_integrity)) {
    return missingHashField(body, 'content_integrity')
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

/**
 * True when a version string is an exact `MAJOR.MINOR.PATCH`.
 *
 * Reuses the manifest version-spec grammar rather than a local regex so
 * there is one definition of what an exact version looks like across
 * manifests, lockfiles, and registry responses.
 */
function isExactVersion(value: string): boolean {
  const parsed = parseVersionSpec(value)
  return parsed.ok && parsed.value.kind === 'exact'
}

function missingHashField(
  body: { name: string; version: string },
  field: 'content_hash' | 'content_integrity',
): RegistryResult<RegistryMetadata> {
  return contractViolation(
    body,
    `is missing a usable ${field} (stale CDN-cached or non-conforming response); refusing to proceed without it`,
  )
}

function contractViolation(body: { name: string; version: string }, detail: string): RegistryResult<RegistryMetadata> {
  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      cause: `registry metadata for ${body.name}@${body.version} ${detail}`,
    },
  }
}
