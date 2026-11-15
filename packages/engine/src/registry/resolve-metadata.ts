import { type createRegistryClient, translateThrownError, translateWireError } from './client.ts'
import { describeVersionSpec } from './describe.ts'
import { facetNameToRoute } from './http.ts'
import { metadataFromWire } from './metadata-wire.ts'
import { openRegistryReadClient } from './read-client.ts'
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
 * Returns one `RegistryMetadata` per input spec, in input order, or a
 * single failure. All-or-nothing: a caller never gets a partially
 * resolved set it could mistake for a complete answer. When several
 * specifiers fail, which failure is returned is not part of the
 * contract — every one of them denies the caller the same complete
 * answer, and callers are required to treat any of them the same way.
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

  const opened = await openRegistryReadClient()
  if (!opened.ok) return opened
  const client = opened.value
  const results = await Promise.all(specs.map((spec) => fetchOne(client, spec)))

  // One pass, building the success list from the same narrowing that
  // proved each entry resolved. Scanning for failures and then
  // re-narrowing in a second pass would leave a branch the compiler
  // can't discharge and that can't happen.
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
